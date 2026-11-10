import * as THREE from 'three';
import { mulberry, RES } from './data.js';
import { GFX, lookFor, makeSky, makeEnvironment, makeSun, focusShadow, shade } from './gfx.js';
import { makeTerrainMaterial, TERRAIN_STYLES } from './terrain.js';
import { buildScenery, nodeMesh, nodeMaterials, makeWind, piece, cyl, cone, box, ico } from './props.js';
import { Kit } from './models.js';
import { buildAmbient } from './ambient.js';
import { buildHorizon } from './horizon.js';
import { waterLevel, buildWater, WATER_STYLES } from './water.js';
const tor = (R, r, o) => piece(new THREE.TorusGeometry(R, r, 6, 22), o);

export const SIZE = 180, HALF = 90;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function makeNoise(seed) {
  const r = mulberry(seed), tab = new Float32Array(256 * 256);
  for (let i = 0; i < tab.length; i++) tab[i] = r();
  const v = (x, y) => tab[((y & 255) << 8) | (x & 255)];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    return (v(xi, yi) * (1 - u) + v(xi + 1, yi) * u) * (1 - w) + (v(xi, yi + 1) * (1 - u) + v(xi + 1, yi + 1) * u) * w;
  };
  return (x, y) => { let a = 0, amp = 0.55, f = 1; for (let i = 0; i < 4; i++) { a += n(x * f, y * f) * amp; amp *= 0.5; f *= 2.1; } return a; };
}

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, ...o });
const E = (color, i = 1) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.5, metalness: 0 });

const END = 72; // spawn / base sit this far from the centre, inside the flat part of the map

// The enemy road. Consumes the first random numbers of a map's stream, so it is
// identical whether called from buildWorld or on its own (e.g. for menu thumbnails).
export function makePath(map, rng = mulberry(map.seed)) {
  const flip = rng() < 0.5 ? -1 : 1;
  const ctrl = [new THREE.Vector3(-END, 0, (rng() - 0.5) * 80)];
  for (let i = 1; i <= map.turns; i++) {
    const x = -END + 2 * END * i / (map.turns + 1) + (rng() - 0.5) * 10;
    const z = flip * (i % 2 ? 1 : -1) * (14 + rng() * map.wind);
    ctrl.push(new THREE.Vector3(x, 0, Math.max(-64, Math.min(64, z))));
  }
  ctrl.push(new THREE.Vector3(END, 0, (rng() - 0.5) * 80));
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
  const pts = curve.getSpacedPoints(Math.round(curve.getLength() / 1.5)).map(p => { p.y = 0; return p; });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, cum, pathLen: cum[cum.length - 1] };
}

export function buildWorld(map) {
  const rng = mulberry(map.seed), fut = map.era === 'futuristic', th = map.theme;
  const scene = new THREE.Scene();
  // ---- atmosphere: procedural sky dome, matching fog, image-based ambient light and a shadow-casting sun (see gfx.js)
  const look = lookFor(map);
  scene.background = new THREE.Color(look.horizon);
  scene.fog = new THREE.FogExp2(look.horizon, look.fog);
  const sky = makeSky(look); scene.add(sky);
  const env = makeEnvironment(look);
  if (env) { scene.environment = env.texture; scene.environmentIntensity = look.ambI; scene.userData.onDispose = () => env.dispose(); }
  else scene.add(new THREE.HemisphereLight(look.zenith, look.horizon, 1.2 * look.ambI)); // no GPU (bot simulations): a flat ambient is enough
  { // a soft sky/ground fill so faces turned away from the sun never go black (more of it under dark skies)
    const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, hz = new THREE.Color(look.horizon), zn = new THREE.Color(look.zenith);
    const fill = Math.max(0.25, Math.min(1.1, 1.15 - 1.6 * lum(hz)));
    scene.add(new THREE.HemisphereLight(zn.clone().lerp(hz, 0.5), hz.clone().multiplyScalar(0.35), fill * (env ? 0.9 : 0.0)));
  }
  const sun = makeSun(look, scene);

  // ---- path ----
  const { pts, cum, pathLen } = makePath(map, rng);
  const pointAt = (d, out = new THREE.Vector3()) => {
    d = Math.max(0, Math.min(pathLen - 0.01, d));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return out.lerpVectors(pts[lo], pts[hi], t);
  };
  const distToPath = (x, z) => {
    let best = 1e9;
    for (let i = 0; i < pts.length; i++) { const dx = pts[i].x - x, dz = pts[i].z - z, d = dx * dx + dz * dz; if (d < best) best = d; }
    return Math.sqrt(best);
  };

  // ---- terrain ----
  const noise = makeNoise(map.seed * 3 + 1), noise2 = makeNoise(map.seed * 5 + 9);
  const N = SIZE + 1, grid = new Float32Array(N * N);
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SIZE, SIZE); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), roadAttr = new Float32Array(pos.count * 3);
  const c1 = new THREE.Color(th.g1), c2 = new THREE.Color(th.g2), tmp = new THREE.Color();
  const S0 = pts[0], B0 = pts[pts.length - 1], lastPt = pts.length - 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i - HALF, z = j - HALF, k = j * N + i;
    let best = 1e9, bi = 0;
    for (let q = 0; q < pts.length; q++) { const dx = pts[q].x - x, dz = pts[q].z - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = q; } }
    const dp = Math.sqrt(best);
    const dEnd = Math.min(Math.hypot(x - S0.x, z - S0.z), Math.hypot(x - B0.x, z - B0.z));
    let h = (noise(x * map.freq, z * map.freq) - 0.35) * map.amp * 2.6;
    if (fut) h = h * 0.4 + Math.floor(h / 2.4) * 2.4 * 0.6;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smooth(HALF - 14, HALF, edge) * 22;                 // boundary wall
    h *= smooth(3, 10, dp) * smooth(7, 16, dEnd);            // road and both end pads stay flat at y=0
    grid[k] = h; pos.setY(k, h);
    // road coordinates for the shader: distance to the centre line, distance along it (gate -> base), signed offset across it
    const pa = pts[Math.max(0, bi - 1)], pb = pts[Math.min(lastPt, bi + 1)], tx = pb.x - pa.x, tz = pb.z - pa.z, tl = Math.hypot(tx, tz) || 1, ox = x - pts[bi].x, oz = z - pts[bi].z;
    roadAttr[k * 3] = dp; roadAttr[k * 3 + 1] = cum[bi] + (ox * tx + oz * tz) / tl; roadAttr[k * 3 + 2] = (-ox * tz + oz * tx) / tl;
    tmp.copy(c1).lerp(c2, noise2(x * 0.05, z * 0.05));
    tmp.multiplyScalar(0.85 + h * 0.025 + (rng() - 0.5) * 0.06);
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aRoad', new THREE.BufferAttribute(roadAttr, 3));
  geo.computeVertexNormals();
  // ---- liquid: every hollow below the map's sea level fills with water, lava, coolant or ice (water.js)
  const wstyle = WATER_STYLES[map.era][map.idx % 6], level = waterLevel(grid, N, HALF, roadAttr);
  const water = level == null ? null : { level, kind: wstyle.kind, css: '#' + wstyle.shallow.toString(16).padStart(6, '0') };
  const terrainMat = makeTerrainMaterial(th, TERRAIN_STYLES[map.era][map.idx % 6], fut, look.kind === 'day' ? 0.2 : look.kind === 'dust' ? 0.14 : 0,
    water && { level, color: wstyle.shallow, caustic: wstyle.kind === 'water' || wstyle.kind === 'coolant' ? 1 : 0 });
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true; terrain.castShadow = true; scene.add(terrain);

  const fastDist = (x, z) => { // road distance by bilinear lookup of the per-vertex attribute (cosmetic placement only)
    const fx = Math.max(0, Math.min(N - 1.001, x + HALF)), fz = Math.max(0, Math.min(N - 1.001, z + HALF)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * N + i;
    return (roadAttr[k * 3] * (1 - u) + roadAttr[(k + 1) * 3] * u) * (1 - v) + (roadAttr[(k + N) * 3] * (1 - u) + roadAttr[(k + N + 1) * 3] * u) * v;
  };
  const heightAt = (x, z) => {
    const fx = Math.max(0, Math.min(N - 1.001, x + HALF)), fz = Math.max(0, Math.min(N - 1.001, z + HALF));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (grid[j * N + i] * (1 - u) + grid[j * N + i + 1] * u) * (1 - v) + (grid[(j + 1) * N + i] * (1 - u) + grid[(j + 1) * N + i + 1] * u) * v;
  };

  // The old star-dots consumed 1800 random numbers here (dark skies only); keep consuming them so every map's resource nodes stay where they always were.
  if (fut || th.sky < 0x606060) for (let i = 0; i < 1800; i++) rng();

  // ---- spawn & base ----
  const spawnPos = pts[0].clone(), basePos = pts[pts.length - 1].clone();
  const spawn = new THREE.Group(), base = new THREE.Group();
  const U = { uTime: { value: 0 } }; // animated effects below (beacons, portal) share this clock
  const beam = (color, radius, height, intensity) => Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.5, height, 24, 1, true).translate(0, height / 2, 0), new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uColor: { value: new THREE.Color(color) }, uI: { value: intensity } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'varying vec3 vN, vV; varying float vY; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mv.xyz; vY = position.y; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 uColor; uniform float uI, uTime; varying vec3 vN, vV; varying float vY;
      void main() { float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.4), h = ${height.toFixed(1)}, up = pow(1. - clamp(vY / h, 0., 1.), 1.8), flick = .85 + .15 * sin(uTime * 3. + vY * .2);
        gl_FragColor = vec4(uColor * f * up * flick * uI, 1.); }` })), { userData: { noShadow: true } });
  const beamAt = (y, ...a) => { const m = beam(...a); m.position.y = y; return m; };
  if (fut) {
    const K = new Kit(), A = new Kit();
    // gate: two pylons with a ring portal between them
    for (const sgn of [-1, 1]) K.metal(cyl(1.4, 1.0, 9, 6, { at: [0, 0, sgn * 5.2], color: 0x2a3550, ao: [0, 9, 0.7] }), box(2.0, 0.8, 2.0, { at: [0, 0, sgn * 5.2], color: 0x1c2438 })).glow(box(0.5, 0.5, 0.5, { at: [0, 9.1, sgn * 5.2], color: 0xff4d6d }), box(0.16, 6, 0.16, { at: [0.95, 1.5, sgn * 5.2], color: 0xff4d6d }));
    K.into(spawn);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.6, 12, 40), E(0xff4d6d, 1.2)); ring.position.y = 5; ring.rotation.y = Math.PI / 2; spawn.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: 'varying vec2 vP; void main() { vP = position.xy / 4.6; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'uniform float uTime; varying vec2 vP; void main() { float r = length(vP), a = atan(vP.y, vP.x), sw = sin(a * 5. - r * 9. + uTime * 2.2) * .5 + .5, sw2 = sin(a * 3. + r * 6. - uTime * 1.4) * .5 + .5; vec3 c = mix(vec3(1., .18, .3), vec3(1., .6, .35), sw); gl_FragColor = vec4(c * (.3 + .7 * sw * sw2) * (1. - smoothstep(.8, 1., r)) * (1. - r * .4) * 1.3, 1.); }' }));
    disc.position.y = 5; disc.rotation.y = Math.PI / 2; disc.userData.noShadow = true; spawn.add(disc);
    spawn.add(beam(0xff4d6d, 1.4, 70, 0.9));
    // base: a reactor core on a stepped pedestal with an energy beacon
    A.metal(cyl(5.8, 5.2, 0.9, 8, { color: 0x2a3550, ao: [0, 0.9, 0.7] }), cyl(4.6, 4.2, 0.9, 8, { at: [0, 0.9, 0], color: 0x34415f }), cyl(3.4, 2.4, 1.2, 8, { at: [0, 1.8, 0], color: 0x232c44 }))
      .glow(tor(5.3, 0.14, { at: [0, 0.6, 0], rot: [Math.PI / 2, 0, 0], color: 0x4de3ff }), tor(4.2, 0.12, { at: [0, 1.5, 0], rot: [Math.PI / 2, 0, 0], color: 0x4de3ff }));
    for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.785; A.metal(box(0.6, 3.6, 0.6, { at: [Math.cos(a) * 4.4, 0.9, Math.sin(a) * 4.4], color: 0x1f2840, ao: [0.9, 4.5, 0.7] })).glow(box(0.4, 0.4, 0.4, { at: [Math.cos(a) * 4.4, 4.5, Math.sin(a) * 4.4], color: 0x4de3ff })); }
    A.into(base);
    const orbm = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 2), E(0x4de3ff, 1.5)); orbm.position.y = 7; orbm.name = 'spin';
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.25, 8, 40), E(0xaaf4ff, 1.1)); r2.position.y = 7; r2.rotation.x = Math.PI / 2.4; r2.name = 'spin2';
    base.add(orbm, r2, beamAt(8, 0x4de3ff, 1.1, 80, 0.8));
  } else {
    const K = new Kit(), A = new Kit();
    // gate: two carved pylons, a lintel with a bronze crest, banners
    for (const sgn of [-1, 1]) {
      K.body(box(3.0, 0.9, 3.0, { at: [0, 0, sgn * 5.2], color: 0x8a7a68, ao: [0, 0.9, 0.7] }), cyl(1.3, 0.95, 9, 6, { at: [0, 0.9, sgn * 5.2], color: 0x7a6a58, tint: 0.07, ao: [0.9, 10, 0.65] }), box(2.4, 0.7, 2.4, { at: [0, 9.8, sgn * 5.2], color: 0x8a7a68 }), box(0.18, 0.9, 1.8, { at: [0, 4.2, sgn * 5.2], color: 0x5a4a3a }))
        .metal(box(0.3, 0.5, 1.6, { at: [0, 6.4, sgn * 5.2], color: 0xc98a3c })).glow(ico(0.45, 1, { at: [0, 10.9, sgn * 5.2], color: 0xffa030 }));
    }
    K.body(box(2.4, 1.3, 11.4, { at: [0, 10.4, 0], color: 0x6a5a4a, tint: 0.06 }), box(1.6, 0.6, 6, { at: [0, 11.7, 0], color: 0x8a7a68 })).metal(box(0.4, 1.1, 3.0, { at: [1.3, 10.4, 0], color: 0xc98a3c }));
    for (const sgn of [-1, 1]) K.body(piece(new THREE.PlaneGeometry(1.6, 4.4, 1, 4), { at: [1.4, 5.4, sgn * 2.2], rot: [0, Math.PI / 2, 0], color: 0xb02020 }), piece(new THREE.PlaneGeometry(1.6, 4.4, 1, 4), { at: [-1.4, 5.4, sgn * 2.2], rot: [0, -Math.PI / 2, 0], color: 0xb02020 }));
    K.into(spawn);
    spawn.add(beam(0xff5a3a, 1.5, 60, 0.6));
    // base: a columned temple on a stepped platform with a tiled roof and a sacred flame
    A.body(box(17, 0.8, 17, { color: 0xc8bea6, tint: 0.05, ao: [0, 0.8, 0.8] }), box(14.6, 0.8, 14.6, { at: [0, 0.8, 0], color: 0xd8ccb0, tint: 0.05 }), box(12.4, 0.6, 12.4, { at: [0, 1.6, 0], color: 0xe2d8c0, tint: 0.04 }));
    for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5], [0, -5], [0, 5], [-5, 0], [5, 0]]) A.body(cyl(0.95, 0.78, 6.4, 10, { at: [x, 2.2, z], color: 0xefe6d2, tint: 0.04, ao: [2.2, 8.6, 0.7] }), box(1.9, 0.5, 1.9, { at: [x, 8.5, z], color: 0xd8ccb0 }));
    A.body(box(12.6, 0.9, 12.6, { at: [0, 9, 0], color: 0xc8bea6, tint: 0.04 }), cone(9.6, 4.6, 4, { at: [0, 9.9, 0], rot: [0, Math.PI / 4, 0], color: 0xc65a3a, tint: 0.08, ao: [9.9, 14.5, 0.75] }))
      .metal(cyl(1.4, 1.0, 1.2, 10, { at: [0, 2.2, 0], color: 0xc98a3c }), tor(1.45, 0.12, { at: [0, 3.35, 0], rot: [Math.PI / 2, 0, 0], color: 0xe6b050 }));
    A.into(base);
    const flame = new THREE.Mesh(new THREE.OctahedronGeometry(1.5), E(0xffcc33, 1.5)); flame.position.y = 5.2; flame.scale.y = 1.5; flame.name = 'spin'; base.add(flame);
    base.add(beamAt(12, 0xffc864, 1.0, 70, 0.55));
  }
  spawn.position.copy(spawnPos); base.position.copy(basePos);
  const dir = pts[3].clone().sub(pts[0]); spawn.rotation.y = -Math.atan2(dir.z, dir.x);
  shade(spawn); shade(base);
  scene.add(spawn, base);

  // ---- resource nodes ----
  const wind = makeWind(fut), nodeMats = nodeMaterials(wind);
  const NODE_BURN = { ancient: [0, 15, 12, 0], futuristic: [32, 16, 0, 0] };
  const nodes = [], taken = [], occl = []; // occl: things that darken the ground around them (baked into the terrain colours)
  const farFromPath = {}; 
  const tries = map.nodeCount * 30;
  const wanted = [];
  for (let i = 0; i < map.nodeCount; i++) { const r = rng(); wanted.push(r < 0.38 ? 0 : r < 0.7 ? 1 : r < 0.92 ? 2 : 3); }
  let wi = 0;
  for (let t = 0; t < tries && wi < wanted.length; t++) {
    const x = (rng() - 0.5) * (SIZE - 24), z = (rng() - 0.5) * (SIZE - 24), type = wanted[wi];
    const dp = distToPath(x, z);
    if (dp < 7 || (type === 3 && dp < 20) || (type === 2 && dp < 11)) continue;
    if (Math.hypot(x - spawnPos.x, z - spawnPos.z) < 14 || Math.hypot(x - basePos.x, z - basePos.z) < 14) continue;
    if (taken.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 36)) continue;
    taken.push({ x, z }); wi++;
    occl.push(map.era === 'ancient' && type === 0 ? { x, z, r: 3.0, k: 0.4 } : { x, z, r: 2.0, k: 0.26 });
    const mesh = nodeMesh(map.era, type, mulberry(map.seed * 131 + wi), nodeMats);
    for (let b = NODE_BURN[map.era][type]; b > 0; b--) rng(); // the old node models drew this many numbers from the shared stream; keep the layout identical
    mesh.position.set(x, heightAt(x, z), z);
    mesh.rotation.y = rng() * 6.28;
    shade(mesh); scene.add(mesh);
    nodes.push({ mesh, type, x, z, hits: [3, 4, 4, 5][type], max: [3, 4, 4, 5][type], yield: [5, 4, 3, 2][type], respawn: 0 });
  }

  // ---- scenery: trees, rocks, grass, crystals... (own random stream, instanced; see props.js)
  const headless = typeof document === 'undefined'; // bot simulations in Node never see the scenery, so skip building it
  const ambient = headless ? null : buildAmbient(map, scene);
  if (!headless) buildHorizon(map, look, scene);
  const liquid = !headless && water ? buildWater({ scene, grid, N, HALF, level, style: wstyle, look }) : null;
  let wasUnder = false;
  const scenery = headless ? { group: new THREE.Group(), update() {} } : buildScenery({ scene, heightAt, distToPath: fastDist, HALF, map, taken, wind, grassScale: GFX.grass, waterLevel: level, keepOut: [{ x: spawnPos.x, z: spawnPos.z, r: 11 }, { x: basePos.x, z: basePos.z, r: 11 }] });
  // the big props also shade the ground around them (baked into the terrain colours below)
  for (const m of scenery.group.children) if (m.isInstancedMesh && /^(conifer|palm|pillar|spike|deadTree|pylon|crystal|cactus)$/.test(m.name)) {
    const big = m.name === 'conifer' || m.name === 'palm', mat4 = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, mat4); p.setFromMatrixPosition(mat4); occl.push(big ? { x: p.x, z: p.z, r: 2.8, k: 0.36 } : { x: p.x, z: p.z, r: 1.6, k: 0.24 }); }
  }

  // ---- ambient occlusion baked into the ground colours: hollows are darker, ridges lighter, and the ground under trees, rocks and pillars is shaded
  {
    const ao = new Float32Array(N * N).fill(1);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i, curv = (grid[k - 1] + grid[k + 1] + grid[k - N] + grid[k + N]) * 0.25 - grid[k]; ao[k] = 1 - Math.max(-0.1, Math.min(0.28, curv * 0.35)); }
    for (const o of occl) {
      const i0 = Math.max(0, Math.floor(o.x + HALF - o.r)), i1 = Math.min(N - 1, Math.ceil(o.x + HALF + o.r)), j0 = Math.max(0, Math.floor(o.z + HALF - o.r)), j1 = Math.min(N - 1, Math.ceil(o.z + HALF + o.r));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(i - HALF - o.x, j - HALF - o.z); if (d < o.r) { const f = 1 - d / o.r; ao[j * N + i] *= 1 - o.k * f * f; } }
    }
    for (let k = 0; k < N * N; k++) { col[k * 3] *= ao[k]; col[k * 3 + 1] *= ao[k]; col[k * 3 + 2] *= ao[k]; }
  }

  const focus = new THREE.Vector3();
  return { scene, heightAt, pts, pointAt, pathLen, distToPath, nodes, spawn, base, spawnPos, basePos, map, look, sun, sky, water,
    // aim the shadow camera at `pos` (the player): crisp shadows nearby, none beyond `half` units
    focus(pos, half = 50) { focus.copy(pos); focus.y = heightAt(pos.x, pos.z); focusShadow(sun, focus, half); },
    animate(t, camPos = focus) {
      sky.material.uniforms.uTime.value = terrainMat.userData.uniforms.uTime.value = t;
      wind.uTime.value = U.uTime.value = t; scenery.update(camPos); ambient?.update(t, camPos, GFX.viewH || 720); liquid?.update(t);
      const under = !!water && camPos.y < water.level - 0.05; // the camera is in the liquid: thick fog in its colour
      if (under !== wasUnder) { wasUnder = under; scene.fog.color.set(under ? wstyle.deep : look.horizon); scene.fog.density = under ? (wstyle.kind === 'lava' ? 0.3 : 0.14) : look.fog; }
      base.traverse(o => {
        if (o.name === 'spin') { o.rotation.y = t * 0.8; o.position.y = (o.userData.y0 ??= o.position.y) + Math.sin(t * 2) * 0.15; }
        if (o.name === 'spin2') o.rotation.z = t * 1.4;
      });
    } };
}
