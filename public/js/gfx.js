// TIMEFALL look & feel: per-map atmosphere (sky, sun, fog, exposure), procedural sky dome, image-based lighting and shadows.
// Everything here is generated in code (no assets). It must stay safe to import in Node (the bot simulations build worlds
// without a GPU): nothing touches WebGL or the DOM unless a renderer was registered via GFX.renderer.
import * as THREE from 'three';

export const GFX = { renderer: null, post: null, viewH: 720, shadowSize: 2048, shadows: true, grass: 1, samples: 4, bloomLevels: 5, usePost: true, pixelRatio: 2, quality: 'high' };

// Quality presets. `grass` scales the grass density; `samples` = MSAA of the HDR target; `pixelRatio` caps the canvas resolution.
export const QUALITY = {
  low:    { usePost: false, shadows: false, shadowSize: 1024, grass: 0.3,  samples: 0, bloomLevels: 0, pixelRatio: 1 },
  medium: { usePost: true,  shadows: true,  shadowSize: 1024, grass: 0.6,  samples: 2, bloomLevels: 4, pixelRatio: 1.5 },
  high:   { usePost: true,  shadows: true,  shadowSize: 2048, grass: 1,    samples: 4, bloomLevels: 5, pixelRatio: 2 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high'];
export function setQuality(name) { if (!QUALITY[name]) name = 'high'; Object.assign(GFX, QUALITY[name]); GFX.quality = name; return name; }
// Software renderers (SwiftShader, llvmpipe...) can't afford the fancy path: default them to Low.
export function detectQuality(gl) {
  try { const e = gl.getExtension('WEBGL_debug_renderer_info'), r = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(r)) return 'low'; } catch {}
  return 'high';
}

const C = h => new THREE.Color(h);

// -------------------------------------------------------------------------------------------------- per-map looks
// One entry per theme (same index as THEMES in data.js). Colours are sRGB hex. `sun` = [azimuthDeg, elevationDeg].
// kind: 'day' (blue sky + clouds) | 'dust' (hazy desert) | 'gloom' (heavy overcast) | 'ash' (volcanic) | 'space' (stars + planet)
const LOOKS = {
  ancient: [
    { kind: 'day',   zenith: 0x2f7fe0, horizon: 0xcfe6ff, sunCol: 0xfff0d0, sun: [-55, 46], cover: 0.50, cloud: 0xffffff, shade: 0x9fb4d0, fog: 0.0042, expo: 1.0,  sunI: 3.1, ambI: 0.9 },
    { kind: 'dust',  zenith: 0x4f8fd0, horizon: 0xf2dcae, sunCol: 0xffe6b0, sun: [-70, 38], cover: 0.22, cloud: 0xfff4e0, shade: 0xc8b090, fog: 0.0052, expo: 1.05, sunI: 3.4, ambI: 0.85 },
    { kind: 'gloom', zenith: 0x7a8ea6, horizon: 0xc9d3de, sunCol: 0xf2f4ff, sun: [-40, 36], cover: 0.82, cloud: 0xe4eaf2, shade: 0x7b8798, fog: 0.0062, expo: 1.0,  sunI: 1.9, ambI: 1.15 },
    { kind: 'day',   zenith: 0x2f9a80, horizon: 0xb4dcc0, sunCol: 0xfff0b8, sun: [-80, 24], cover: 0.40, cloud: 0xf4fff0, shade: 0x86a89a, fog: 0.0062, expo: 1.0,  sunI: 3.0, ambI: 0.9, mist: 1 },
    { kind: 'ash',   zenith: 0x1c0c0c, horizon: 0x8a3a24, sunCol: 0xff6a30, sun: [-50, 14], cover: 0.90, cloud: 0xff7a3a, shade: 0x2a1412, fog: 0.0075, expo: 1.1, sunI: 2.4, ambI: 0.7, glow: 0xff5a1e },
    { kind: 'day',   zenith: 0x7fb0e0, horizon: 0xe6f0f8, sunCol: 0xfff6ee, sun: [-60, 22], cover: 0.45, cloud: 0xffffff, shade: 0xaec0d6, fog: 0.0058, expo: 1.0,  sunI: 3.0, ambI: 1.05 },
  ],
  futuristic: [
    { kind: 'space', zenith: 0x02050f, horizon: 0x1a3d73, sunCol: 0xb8ccff, sun: [-55, 40], stars: 1, planet: { dir: [-35, 28], r: 0.16, col: 0x4f7fd0, ring: 1, bands: 0x7fb0ff }, aurora: [0x3dffc8, 0x4d8dff], nebula: 0x2a4a9a, fog: 0.0038, expo: 1.05, sunI: 2.2, ambI: 1.1 },
    { kind: 'space', zenith: 0x0a0316, horizon: 0x6a1f8a, sunCol: 0xffc8ff, sun: [-60, 34], stars: 1, planet: { dir: [30, 22], r: 0.11, col: 0xc45cff, ring: 0, bands: 0xff8ae8 }, moon2: [-100, 40], nebula: 0x8a2ab0, fog: 0.0042, expo: 1.05, sunI: 2.2, ambI: 1.15 },
    { kind: 'space', zenith: 0x1a0a08, horizon: 0xa8583a, sunCol: 0xffc090, sun: [-45, 18], stars: 0.45, planet: { dir: [40, 14], r: 0.07, col: 0xd08a60, ring: 0, bands: 0xf0b890 }, moon2: [-130, 28], nebula: 0x8a3a20, fog: 0.0066, expo: 1.1, sunI: 2.6, ambI: 1.0, haze: 1.4 },
    { kind: 'space', zenith: 0x020a04, horizon: 0x2e7a28, sunCol: 0xd8ffb0, sun: [-65, 30], stars: 0.9, planet: { dir: [-120, 34], r: 0.09, col: 0x7ad060, ring: 1, bands: 0xc8ff90 }, aurora: [0x7dff4d, 0x28e0a0], nebula: 0x2a7a20, fog: 0.0052, expo: 1.05, sunI: 2.0, ambI: 1.1 },
    { kind: 'space', grade: 'day', bloom: 0.5, zenith: 0x4a78b8, horizon: 0xc8def2, sunCol: 0xf2f8ff, sun: [-50, 28], stars: 0.12, planet: { dir: [35, 24], r: 0.14, col: 0xa8c4e8, ring: 1, bands: 0xe0f0ff }, nebula: 0x7aa8e0, fog: 0.0052, expo: 1.0, sunI: 3.0, ambI: 1.1 },
    { kind: 'space', zenith: 0x000103, horizon: 0x1a1a38, sunCol: 0xa8a8ff, sun: [-70, 30], stars: 1.25, planet: { dir: [20, 18], r: 0.22, col: 0x120a24, ring: 1, bands: 0x6a4aff, rim: 1 }, nebula: 0x40308a, fog: 0.0034, expo: 1.05, sunI: 1.7, ambI: 1.2 },
  ],
};

export function lookFor(map) {
  const base = LOOKS[map.era][map.idx % 6], th = map.theme;
  const L = { ...base };
  L.horizon = th.fog ? mixHex(base.horizon, th.fog, 0.25) : base.horizon; // stay close to the map's fog colour so the world melts into the sky
  const az = (base.sun[0] * Math.PI) / 180, el = (base.sun[1] * Math.PI) / 180;
  L.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  return L;
}
function mixHex(a, b, t) { return C(a).lerp(C(b), t).getHex(); }

// -------------------------------------------------------------------------------------------------- sky dome
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // drawn at the far plane, after the opaque scene: the sky shader then only runs where nothing else was drawn
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uSunDir, uSunCol, uCloudLit, uCloudShade, uNebula, uAuroraA, uAuroraB, uPlanetCol, uPlanetBands, uPlanetDir, uGlow;
uniform float uTime, uCover, uStars, uDisc, uHaze, uAurora, uNeb, uPlanetR, uRing, uRim, uNight, uMoon2R;
uniform vec3 uMoon2Dir;
varying vec3 vDir;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h31(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec2 p) { float a = 0., w = .5; for (int i = 0; i < 5; i++) { a += vn(p) * w; p = p * 2.03 + 17.1; w *= .5; } return a; }
float fbm3(vec3 p) { float a = 0., w = .5; for (int i = 0; i < 4; i++) { a += vn3(p) * w; p = p * 2.07 + 11.3; w *= .5; } return a; }

vec3 starField(vec3 d) {
  vec3 col = vec3(0.);
  for (int k = 0; k < 3; k++) {
    float sc = k == 0 ? 90. : k == 1 ? 180. : 320.;
    vec3 sp = d * sc, ip = floor(sp), fp = fract(sp) - .5;
    float r = h31(ip + float(k) * 7.7);
    vec3 off = vec3(h31(ip + 3.1), h31(ip + 5.7), h31(ip + 8.3)) - .5;
    float dist = length(fp - off * .6);
    float rad = k == 0 ? .16 : k == 1 ? .12 : .09;
    float s = smoothstep(rad, 0., dist) * step(.965 - float(k) * .006, r);
    float tw = .75 + .25 * sin(uTime * (1.5 + r * 6.) + r * 60.);
    vec3 tint = mix(vec3(.75, .85, 1.), vec3(1., .9, .75), h31(ip + 9.9));
    col += s * tw * tint * (k == 0 ? 2.4 : 1.4);
  }
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y, t = clamp(h, 0., 1.);
  vec3 col = mix(uHorizon, uZenith, pow(t, .45));
  col = mix(col, uHorizon * .85, smoothstep(0., -.3, h));
  col = mix(col, uHorizon, exp(-t * 9.) * uHaze);
  float sd = max(dot(d, uSunDir), 0.);

  // ---- sun glow + disc
  col += uSunCol * (pow(sd, 5.) * .16 + pow(sd, 36.) * .42 + pow(sd, 600.) * 1.8) * (1. - .6 * uNight);
  col += uSunCol * uDisc * smoothstep(.99955, .99975, sd) * 30.;

  // ---- space: nebula, stars, planet, moons, aurora
  if (uNight > 0.) {
    float nb = fbm3(d * 2.4 + vec3(0., uTime * .004, 0.));
    float band = smoothstep(.35, .85, nb) * uNeb;
    col += uNebula * band * (.3 + .7 * smoothstep(0., .6, t)) * .32;
    float nb2 = fbm3(d * 5.5 + 4.);
    col += uNebula * smoothstep(.5, .95, nb2) * uNeb * .12;
    col += starField(d) * uStars * smoothstep(-.05, .22, h) * (1. - clamp(uHaze - 1., 0., .6));
    // ringed planet: a lit sphere with soft banding and an optional ring seen at a tilt
    if (uPlanetR > 0.) {
      vec3 pc = normalize(uPlanetDir);
      vec3 ax = normalize(cross(pc, vec3(0., 1., 0.))), ay = cross(ax, pc);
      vec2 q = vec2(dot(d, ax), dot(d, ay)); float fwd = dot(d, pc);
      vec2 u = q / uPlanetR;
      float r2 = dot(u, u);
      if (fwd > 0.) {
        if (uRing > .5) { // ring: an ellipse around the planet (tilted ~70 deg), behind the disc for the upper half
          vec2 ru = vec2(u.x * .965 - u.y * .26, (u.x * .26 + u.y * .965) / .22);
          float rr = length(ru);
          float ring = smoothstep(1.35, 1.42, rr) * (1. - smoothstep(2.0, 2.06, rr)) * (.55 + .45 * sin(rr * 55.));
          ring *= 1. - .85 * smoothstep(1.55, 1.7, rr) * (1. - smoothstep(1.72, 1.78, rr)); // Cassini-style gap
          bool front = ru.y < 0.;
          if (!front || r2 > 1.) col = mix(col, uPlanetBands * .9 + uSunCol * .1, ring * .75);
        }
        if (r2 < 1.) {
          vec3 n = vec3(u, sqrt(1. - r2));
          vec3 L = normalize(vec3(.6, .35, .75));
          float lit = clamp(dot(n, L) * .9 + .1, 0., 1.);
          float bands = .5 + .5 * sin(n.y * 9. + fbm(n.xy * 3.) * 3.);
          vec3 pcol = mix(uPlanetCol, uPlanetBands, bands * .6);
          vec3 sh = pcol * (.06 + lit * 1.15);
          sh += uPlanetBands * pow(1. - n.z, 3.) * (.25 + .6 * uRim); // atmosphere rim
          col = mix(col, sh, smoothstep(1., .985, sqrt(r2)));
          if (uRing > .5) { vec2 ru = vec2(u.x * .965 - u.y * .26, (u.x * .26 + u.y * .965) / .22); float rr = length(ru);
            float ring = smoothstep(1.35, 1.42, rr) * (1. - smoothstep(2.0, 2.06, rr)) * (.55 + .45 * sin(rr * 55.));
            if (ru.y < 0.) col = mix(col, uPlanetBands * .9 + uSunCol * .1, ring * .8); }
        } else if (uRim > .5) col += uPlanetBands * exp(-(sqrt(r2) - 1.) * 14.) * .22; // halo around a dark world
      }
    }
    if (uMoon2R > 0.) {
      vec3 mc = normalize(uMoon2Dir); float a = acos(clamp(dot(d, mc), -1., 1.));
      float m = smoothstep(uMoon2R, uMoon2R * .86, a);
      col = mix(col, uSunCol * (.55 + .4 * vn(d.xz * 40.)), m);
    }
    if (uAurora > 0.) { // slow curtains low over the horizon
      float ah = smoothstep(.04, .2, h) * (1. - smoothstep(.35, .75, h));
      vec2 ap = d.xz / (h + .3) * 1.6;
      float w = fbm(vec2(ap.x * 1.4 + uTime * .02, ap.y * 2.2));
      float rib = pow(1. - abs(sin(ap.x * 2.4 + w * 5. + uTime * .06)), 5.);
      float curtain = rib * smoothstep(.25, .75, fbm(ap * vec2(1.2, 2.6) + 5.));
      col += mix(uAuroraA, uAuroraB, clamp(h * 2.6, 0., 1.)) * curtain * ah * .55 * uAurora;
    }
  }

  // ---- clouds: a plane of drifting noise, shaded towards the sun
  if (uCover > 0. && h > .0) {
    vec2 uv = d.xz / (h + .14) * .85 + vec2(uTime * .006, uTime * .0025);
    float n = fbm(uv * 1.15);
    float c = smoothstep(1. - uCover - .02, 1. - uCover + .30, n);
    float n2 = fbm(uv * 1.15 + uSunDir.xz * .16);
    float lit = clamp((n - n2) * 5. + .55, 0., 1.);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uSunCol * pow(sd, 6.) * (1. - c * .6) * .65;       // silver lining towards the sun
    cc = mix(cc, uGlow, uGlow.r * 0. + (uGlow.r + uGlow.g + uGlow.b > 0. ? (1. - lit) * .55 : 0.)); // lava-lit undersides
    float fade = smoothstep(.0, .22, h);
    col = mix(col, cc, c * fade * (.96 - .2 * uNight));
  }

  // ---- gentle banding dither
  col += (h21(gl_FragCoord.xy) - .5) / 255.;
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSkyMaterial(look, { disc = true } = {}) {
  const night = look.kind === 'space' ? 1 : 0;
  const pl = look.planet;
  const v3 = h => new THREE.Color(h);
  const dirOf = ([az, el]) => { const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180; return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize(); };
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    uniforms: {
      uTime: { value: 0 }, uZenith: { value: v3(look.zenith) }, uHorizon: { value: v3(look.horizon) }, uSunDir: { value: look.sunDir.clone() }, uSunCol: { value: v3(look.sunCol) },
      uCloudLit: { value: v3(look.cloud ?? 0xffffff) }, uCloudShade: { value: v3(look.shade ?? 0x8090a0) }, uGlow: { value: v3(look.glow ?? 0x000000) },
      uCover: { value: look.cover ?? 0 }, uStars: { value: look.stars ?? 0 }, uDisc: { value: disc ? (night ? 0.75 : 1) : 0 }, uHaze: { value: look.haze ?? (look.kind === 'dust' ? 1.5 : look.mist ? 1.3 : 1) },
      uNight: { value: night }, uNebula: { value: v3(look.nebula ?? 0x000000) }, uNeb: { value: look.nebula ? 1 : 0 },
      uAurora: { value: look.aurora ? 1 : 0 }, uAuroraA: { value: v3(look.aurora?.[0] ?? 0) }, uAuroraB: { value: v3(look.aurora?.[1] ?? 0) },
      uPlanetR: { value: pl?.r ?? 0 }, uPlanetDir: { value: pl ? dirOf(pl.dir) : new THREE.Vector3(0, 1, 0) }, uPlanetCol: { value: v3(pl?.col ?? 0) }, uPlanetBands: { value: v3(pl?.bands ?? 0) },
      uRing: { value: pl?.ring ? 1 : 0 }, uRim: { value: pl?.rim ? 1 : 0 },
      uMoon2R: { value: look.moon2 ? 0.035 : 0 }, uMoon2Dir: { value: look.moon2 ? dirOf(look.moon2) : new THREE.Vector3(0, 1, 0) },
    },
  });
}

// A big sphere that always sits on the camera, drawn after the opaque scene (it only fills what is still empty).
export function makeSky(look) {
  const mat = makeSkyMaterial(look);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 40, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = 1000; mesh.name = 'sky';
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); };
  return mesh;
}

// Image-based lighting: bake the sky (without the sun disc, which the real directional light provides) into a PMREM cube.
export function makeEnvironment(look, r = GFX.renderer) {
  if (!r) return null;
  try {
    const sc = new THREE.Scene();
    const mat = makeSkyMaterial(look, { disc: false });
    const m = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat); sc.add(m);
    const pm = new THREE.PMREMGenerator(r);
    const rt = pm.fromScene(sc, 0, 0.1, 200);
    pm.dispose(); m.geometry.dispose(); mat.dispose();
    return rt;
  } catch (e) { console.warn('environment bake failed', e); return null; }
}

// -------------------------------------------------------------------------------------------------- sun + shadows
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export function makeSun(look, scene) {
  const sun = new THREE.DirectionalLight(look.sunCol, look.sunI);
  sun.castShadow = GFX.shadows;
  const sh = sun.shadow;
  sh.mapSize.set(GFX.shadowSize, GFX.shadowSize);
  sh.bias = -0.00035; sh.normalBias = 0.05; sh.radius = 2.5;
  sh.camera.near = 1; sh.camera.far = 420;
  scene.add(sun, sun.target);
  sun.userData.dir = look.sunDir.clone();
  sun.userData.extent = 0;
  return sun;
}

// Frame the shadow camera around `focus` (world position) with the given half-extent, snapped to whole shadow texels so edges don't crawl.
export function focusShadow(sun, focus, half) {
  const sh = sun.shadow, cam = sh.camera;
  if (sun.userData.extent !== half) {
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix(); sun.userData.extent = half;
  }
  const dir = sun.userData.dir, tex = (2 * half) / sh.mapSize.x;
  // light-space basis (z points from the focus towards the sun); snap the focus to whole texels along x/y
  _z.copy(dir); _x.crossVectors(_up, _z).normalize(); _y.crossVectors(_z, _x);
  const px = Math.round(focus.dot(_x) / tex) * tex, py = Math.round(focus.dot(_y) / tex) * tex, pz = focus.dot(_z);
  sun.target.position.set(0, 0, 0).addScaledVector(_x, px).addScaledVector(_y, py).addScaledVector(_z, pz);
  sun.position.copy(sun.target.position).addScaledVector(dir, 220);
  sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
}

// Mark every mesh under `obj` as a shadow caster and/or receiver.
export function shade(obj, cast = true, receive = true) {
  obj.traverse(o => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}
