// Scenery: procedurally modelled, faceted, vertex-coloured props (trees, rocks, crystals, grass...) merged into single
// geometries and drawn with instancing, plus the resource-node models. No assets, no textures.
// Randomness here comes from its own seeded stream, so scenery never disturbs the gameplay layout (see world.js).
import * as THREE from 'three';
import { mulberry } from './data.js';

const clamp01 = v => Math.max(0, Math.min(1, v));
const hash = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const lerpHex = (a, b, t) => _c.set(a).lerp(_c2.set(b), t).getHex();

// ------------------------------------------------------------------ geometry kit
// One faceted piece. o: at [x,y,z], rot [x,y,z], scale n | [x,y,z], color, tint (per-face brightness variation), jitter (vertex
// displacement; shared corners move together), ao [y0,y1,low] (darken towards the bottom), sway [y0,y1,max] (wind weight).
function piece(geo, o = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  const pa = g.attributes.position, j = o.jitter || 0, seed = o.seed || 0;
  if (j) for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    pa.setXYZ(i, x + (hash(x * 3.1 + seed, y * 3.7, z * 2.9) - 0.5) * j, y + (hash(x * 2.3, y * 4.1 + seed, z * 3.3) - 0.5) * j, z + (hash(x * 4.3, y * 2.7, z * 3.9 + seed) - 0.5) * j);
  }
  const sc = Array.isArray(o.scale) ? o.scale : [o.scale ?? 1, o.scale ?? 1, o.scale ?? 1];
  _m.compose(_p.fromArray(o.at || [0, 0, 0]), _q.setFromEuler(_e.set(...(o.rot || [0, 0, 0]), o.order || 'XYZ')), _s.fromArray(sc));
  g.applyMatrix4(_m); g.computeVertexNormals();
  const n = pa.count, col = new Float32Array(n * 3), sway = new Float32Array(n), v = o.tint ?? 0.1, ao = o.ao, sw = o.sway;
  _c.set(o.color ?? 0xffffff);
  for (let i = 0; i < n; i++) {
    const f = (i / 3) | 0, y = pa.getY(i);
    let k = 1 + (hash(f * 1.7 + seed, f * 0.3, 1.1) - 0.5) * 2 * v;
    if (ao) k *= ao[2] + (1 - ao[2]) * clamp01((y - ao[0]) / (ao[1] - ao[0]));
    col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
    if (sw) { const t = clamp01((y - sw[0]) / (sw[1] - sw[0])); sway[i] = sw[2] * t * t; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  return g;
}
export function merge(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), W = new Float32Array(n);
  let o = 0;
  for (const g of list) {
    const a = g.attributes; P.set(a.position.array, o * 3); N.set(a.normal.array, o * 3); C.set(a.color.array, o * 3); W.set(a.aSway.array, o); o += a.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3)); out.setAttribute('aSway', new THREE.BufferAttribute(W, 1));
  return out;
}
// shapes with their base on y = at.y
const cyl = (r0, r1, h, seg, o) => piece(new THREE.CylinderGeometry(r1, r0, h, seg).translate(0, h / 2, 0), o);   // r0 = bottom radius, r1 = top
const cone = (r, h, seg, o) => piece(new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), o);
const box = (w, h, d, o) => piece(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), o);
const ico = (r, det, o) => piece(new THREE.IcosahedronGeometry(r, det), o);
const oct = (r, o) => piece(new THREE.OctahedronGeometry(r), o);
// a two-sided ribbon along a polyline (grass blades, fronds, fern leaves); normals lean towards +Y so it shades like the ground it grows from
function ribbon(pts, half, side, o = {}) {
  const n = pts.length, tri = [], nrm = [];
  const P = pts.map((p, i) => [[p[0] - side[0] * half[i], p[1], p[2] - side[2] * half[i]], [p[0] + side[0] * half[i], p[1], p[2] + side[2] * half[i]]]);
  const push = (a, b, c) => { tri.push(...a, ...b, ...c); };
  for (let i = 0; i < n - 1; i++) {
    const [l0, r0] = P[i], [l1, r1] = P[i + 1];
    push(l0, r0, l1); push(r0, r1, l1);   // front
    push(r0, l0, l1); push(r1, r0, l1);   // back
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  const cnt = tri.length / 3; g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(cnt * 2), 2));
  const gg = piece(g, { ...o, at: o.at, rot: o.rot });
  const nn = gg.attributes.normal; // soften: 40% face normal, 60% up
  for (let i = 0; i < nn.count; i++) { const x = nn.getX(i), y = nn.getY(i), z = nn.getZ(i), l = Math.hypot(x * 0.4, y * 0.4 + 0.6, z * 0.4) || 1; nn.setXYZ(i, x * 0.4 / l, (y * 0.4 + 0.6) / l, z * 0.4 / l); }
  return gg;
}
const bladeTuft = (rng, o) => { // n blades fanned from the centre
  const parts = [], { n = 5, h = 0.8, lo, hi } = o;
  for (let i = 0; i < n; i++) {
    const a = rng() * 6.283, bl = h * (0.65 + rng() * 0.6), bend = (0.15 + rng() * 0.35) * bl, dx = Math.cos(a), dz = Math.sin(a), r0 = rng() * 0.1;
    const pts = [[dx * r0, 0, dz * r0], [dx * (r0 + bend * 0.35), bl * 0.55, dz * (r0 + bend * 0.35)], [dx * (r0 + bend), bl, dz * (r0 + bend)]];
    const side = [-dz, 0, dx], w = 0.04 + rng() * 0.025;
    parts.push(ribbon(pts, [w, w * 0.62, 0.001], side, { color: lerpHex(lo, hi, 0.2 + rng() * 0.8), tint: 0.06, ao: [0, bl, 0.5], sway: [0, bl, 1], seed: i * 3 }));
  }
  return merge(parts);
};

// A material whose glow follows the vertex colours (dark roots -> bright tips); used for every emissive model part.
export function glowMaterial(intensity = 1) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0, emissive: 0xffffff, emissiveIntensity: intensity });
  m.customProgramCacheKey = () => 'glowvc';
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;'); };
  return m;
}
export { piece, cyl, cone, box, ico, oct, ribbon, lerpHex, hash };

// ------------------------------------------------------------------ prop builders: (rng, pal) -> { body, glow? } geometries
// pal = [dark, light] colours for the foliage / stone / crystal, so each map recolours the same shapes.
const B = {
  conifer(rng, pal, o = {}) {
    const parts = [cyl(0.34, 0.22, 1.4, 6, { color: 0x5a3a1f, ao: [0, 1.4, 0.55] })], tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const r = 1.8 - i * 0.4, y = 0.9 + i * 0.95, h = 1.9 - i * 0.12, t = i / (tiers - 1);
      parts.push(cone(r, h, 7, { at: [0, y, 0], rot: [0, rng() * 6, 0], color: o.snow && i > 0 ? lerpHex(pal[0], o.snow, 0.35 + 0.45 * t) : lerpHex(pal[0], pal[1], t), jitter: 0.14, seed: i + 1, ao: [y, y + h, 0.55], sway: [0, 5.5, 0.5] }));
    }
    return { body: merge(parts) };
  },
  roundTree(rng, pal) {
    const parts = [cyl(0.5, 0.34, 3.4, 6, { color: 0x6b4423, ao: [0, 3.4, 0.6] })];
    parts.push(ico(2.2, 1, { at: [0, 5.1, 0], scale: [1, 1.05, 1], color: lerpHex(pal[0], pal[1], 0.6), jitter: 0.5, seed: 3, ao: [2.9, 7.3, 0.55], sway: [2, 7.4, 0.4], tint: 0.12 }));
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + rng(); parts.push(ico(1.4 + rng() * 0.3, 1, { at: [Math.cos(a) * 1.5, 4.3 + rng() * 0.9, Math.sin(a) * 1.5], color: lerpHex(pal[0], pal[1], rng() * 0.8), jitter: 0.4, seed: 5 + i, ao: [2.7, 6.2, 0.55], sway: [2, 7.4, 0.4], tint: 0.12 })); }
    return { body: merge(parts) };
  },
  palm(rng, pal, o = {}) {
    const parts = [], segs = 6, bend = (rng() - 0.5) * 1.6; let x = 0, y = 0;
    for (let i = 0; i < segs; i++) { const t = i / segs, tilt = bend * 0.18; parts.push(cyl(0.3 - t * 0.12, 0.3 - (t + 1 / segs) * 0.12, 0.75, 6, { at: [x, y, 0], rot: [0, 0, -tilt], color: lerpHex(o.trunk ?? 0x8a6a3a, 0x5a4020, (i % 2) * 0.35), ao: [0, 4.5, 0.65], sway: [0, 5, 0.25] })); x += Math.sin(tilt) * 0.75; y += Math.cos(tilt) * 0.75; }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.283 + rng() * 0.3, L = 2.6 + rng() * 0.7, droop = 0.9 + rng() * 0.5, dx = Math.cos(a), dz = Math.sin(a), pts = [], half = [];
      for (let k = 0; k <= 5; k++) { const t = k / 5; pts.push([x + dx * L * t, y + 0.25 + Math.sin(t * 2.3) * 0.7 - droop * t * t * 1.5, dz * L * t + 0]); pts[k][2] = dz * L * t; half.push(Math.sin(Math.PI * (0.12 + 0.8 * t)) * 0.38); }
      parts.push(ribbon(pts, half, [-dz, 0, dx], { color: lerpHex(pal[0], pal[1], rng()), tint: 0.08, ao: [y - 0.5, y + 1.6, 0.6], sway: [y - 1, y + 1.5, 0.9], seed: i }));
    }
    return { body: merge(parts) };
  },
  cactus(rng, pal) {
    const parts = [cyl(0.42, 0.34, 3.4, 8, { color: pal[0], ao: [0, 3.4, 0.7], tint: 0.06 }), ico(0.34, 1, { at: [0, 3.4, 0], color: pal[1], jitter: 0.05 })];
    for (const s of [-1, 1]) { const h = 0.9 + rng() * 0.8; parts.push(cyl(0.22, 0.22, 0.8, 7, { at: [s * 0.55, 1.2 + rng() * 0.6, 0], rot: [0, 0, -s * 1.57], color: pal[0] }), cyl(0.2, 0.18, h, 7, { at: [s * 1.05, 1.5, 0], color: pal[1] }), ico(0.2, 1, { at: [s * 1.05, 1.5 + h, 0], color: pal[1], jitter: 0.04 })); }
    return { body: merge(parts) };
  },
  bush(rng, pal) {
    const parts = [];
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + rng(); parts.push(ico(0.62 + rng() * 0.3, 1, { at: [Math.cos(a) * 0.5, 0.42 + rng() * 0.15, Math.sin(a) * 0.5], scale: [1, 0.8, 1], color: lerpHex(pal[0], pal[1], rng()), jitter: 0.22, seed: i, ao: [0, 1.1, 0.5], sway: [0, 1.2, 0.5] })); }
    return { body: merge(parts) };
  },
  rock(rng, pal) {
    const parts = [ico(0.75 + rng() * 0.25, 1, { at: [0, 0.28, 0], scale: [1.15, 0.7, 1], rot: [0, rng() * 6, 0], color: lerpHex(pal[0], pal[1], rng()), jitter: 0.3, seed: rng() * 9, ao: [0, 0.8, 0.6], tint: 0.14 })];
    if (rng() < 0.6) parts.push(ico(0.32, 1, { at: [0.8, 0.12, 0.4], scale: [1, 0.7, 1], color: lerpHex(pal[0], pal[1], rng()), jitter: 0.18, seed: 7 }));
    return { body: merge(parts) };
  },
  pillar(rng, pal) {
    const h = 2.6 + rng() * 2.4, broken = rng() < 0.5, parts = [box(1.6, 0.35, 1.6, { color: pal[0], tint: 0.05 }), cyl(0.62, 0.55, h, 8, { at: [0, 0.3, 0], color: pal[1], ao: [0, h, 0.7], tint: 0.06 })];
    if (broken) parts.push(box(0.9, 0.7, 0.9, { at: [1.1, 0, 0.3], rot: [0.1, 0.5, 0.2], color: pal[0], jitter: 0.08, seed: 4 }), cone(0.5, 0.6, 5, { at: [0, h + 0.2, 0], rot: [0.25, 0, 0.1], color: pal[1], jitter: 0.2 }));
    else parts.push(box(1.5, 0.4, 1.5, { at: [0, h + 0.3, 0], color: pal[0], tint: 0.05 }));
    return { body: merge(parts) };
  },
  spike(rng, pal) {
    const parts = [cone(0.9, 4 + rng() * 3.4, 5, { color: pal[0], jitter: 0.25, seed: 1, ao: [0, 6, 0.5], tint: 0.12 })];
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + rng(); parts.push(cone(0.4 + rng() * 0.2, 1.6 + rng() * 2, 5, { at: [Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9], rot: [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25], color: lerpHex(pal[0], pal[1], rng()), jitter: 0.15, seed: i })); }
    return { body: merge(parts) };
  },
  deadTree(rng, pal) {
    const parts = [cyl(0.28, 0.12, 4.2, 6, { color: pal[0], ao: [0, 4, 0.6], tint: 0.08 })];
    for (let i = 0; i < 4; i++) { const a = i * 1.6 + rng(), y = 1.6 + i * 0.6, L = 1.4 - i * 0.2; parts.push(cyl(0.12, 0.05, L, 5, { at: [0, y, 0], rot: [Math.sin(a) * 1.0, a, Math.cos(a) * 1.0], color: pal[1] })); }
    return { body: merge(parts) };
  },
  fern(rng, pal) {
    const parts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283 + rng() * 0.4, L = 1.3 + rng() * 0.6, dx = Math.cos(a), dz = Math.sin(a), pts = [], half = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([dx * L * t, 0.15 + Math.sin(t * 2.4) * 0.5 - t * t * 0.5, dz * L * t]); half.push(Math.sin(Math.PI * (0.1 + 0.85 * t)) * 0.2); }
      parts.push(ribbon(pts, half, [-dz, 0, dx], { color: lerpHex(pal[0], pal[1], rng()), tint: 0.08, ao: [0, 0.8, 0.55], sway: [0, 0.9, 0.7], seed: i }));
    }
    return { body: merge(parts) };
  },
  grass(rng, pal, o) { return { body: bladeTuft(rng, { n: 5, h: o.h, lo: pal[0], hi: pal[1] }) }; },
  // ---- futuristic
  pylon(rng, pal) {
    const h = 4 + rng() * 4;
    const body = merge([box(0.7, h, 0.7, { color: 0x2a3350, ao: [0, h, 0.7], tint: 0.04 }), box(1.1, 0.5, 1.1, { color: 0x1c2438 }), box(0.5, 0.35, 0.5, { at: [0, h, 0], color: 0x1c2438 })]);
    const glow = merge([box(0.62, 0.42, 0.62, { at: [0, h + 0.3, 0], color: 0xffffff }), box(0.76, 0.12, 0.76, { at: [0, h * 0.55, 0], color: 0xffffff })]);
    return { body, glow };
  },
  crystal(rng, pal) {
    const parts = [], n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = i * 2.3 + rng(), r = i ? 0.5 + rng() * 0.5 : 0, h = (i ? 1.2 : 2.2) + rng() * 1.8, w = 0.34 + rng() * 0.22;
      parts.push(cyl(w, w * 0.9, h * 0.72, 6, { at: [Math.cos(a) * r, 0, Math.sin(a) * r], rot: [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3], color: lerpHex(pal[0], pal[1], rng()), tint: 0.18, ao: [0, h, 0.55] }),
        cone(w * 0.9, h * 0.35, 6, { at: [Math.cos(a) * r + Math.sin(a) * 0.3 * h * 0.72, h * 0.72, Math.sin(a) * r - Math.cos(a) * 0.3 * h * 0.72], rot: [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3], color: pal[1], tint: 0.1 }));
    }
    return { glow: merge(parts) };
  },
  shard(rng, pal) { // glowing needles: the futuristic "grass"
    const parts = [];
    for (let i = 0; i < 4; i++) { const a = rng() * 6.283, h = 0.35 + rng() * 0.55; parts.push(cone(0.05 + rng() * 0.04, h, 4, { at: [Math.cos(a) * rng() * 0.18, 0, Math.sin(a) * rng() * 0.18], rot: [(rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5], color: lerpHex(pal[0], pal[1], rng()), ao: [0, h, 0.4], sway: [0, h, 0.5] })); }
    return { glow: merge(parts) };
  },
  crate(rng, pal) {
    return { body: merge([box(1.8, 1.4, 1.8, { rot: [0, rng() * 6, 0], color: lerpHex(pal[0], pal[1], rng()), tint: 0.05, ao: [0, 1.4, 0.7] }), box(1.9, 0.14, 1.9, { at: [0, 1.2, 0], color: 0x2a2a30 })]) };
  },
};

// ------------------------------------------------------------------ per-map scenery recipes
// kind: builder, n: how many, pal: [a, b], min: clearance from the road, size: random scale range, r: spacing radius, cast: casts shadows
const T = (kind, n, pal, extra = {}) => ({ kind, n, pal, min: 7, r: 3, size: [0.8, 1.5], cast: true, ...extra });
const S = (kind, n, pal, extra = {}) => ({ kind, n, pal, min: 4.5, r: 1.2, size: [0.7, 1.4], cast: true, ...extra });
const G = (density, pal, h) => ({ kind: 'grass', density, pal, h, min: 2.9, grass: true });
const RECIPES = {
  ancient: [
    [T('conifer', 125, [0x1f5a2a, 0x4c9c46]), S('bush', 80, [0x3f8f3a, 0x78c24a]), S('rock', 50, [0x86847e, 0xaeaca4]), G(2.4, [0x4a9232, 0xa6d457], 0.55)],
    [T('palm', 75, [0x3f8a34, 0x84c24c], { trunk: 0x9a7a4a }), S('cactus', 45, [0x4a8a4a, 0x7ab062], { min: 6 }), S('bush', 40, [0x8f7f40, 0xc2ae5a]), S('rock', 60, [0xa8804f, 0xd2ac7a]), G(0.45, [0xa38a48, 0xe6cc7c], 0.5)],
    [T('pillar', 70, [0xbdb7a8, 0xe4decf], { r: 2.5 }), S('bush', 30, [0x667656, 0x8a9a74]), S('rock', 90, [0x66666a, 0x8e8c88]), G(0.9, [0x66845a, 0xa6b682], 0.5)],
    [T('conifer', 200, [0x1a4424, 0x2f7c3c], { size: [0.9, 1.7] }), S('fern', 150, [0x2a642c, 0x66ac46]), S('bush', 50, [0x2c6a32, 0x4f9a48]), S('rock', 40, [0x66665a, 0x88887a]), G(1.7, [0x2d7632, 0x70b44e], 0.6)],
    [T('spike', 110, [0x1a1412, 0x45322a]), T('deadTree', 45, [0x2a1f1a, 0x4a3328], { min: 6 }), S('rock', 90, [0x241f1d, 0x4a3b35])],
    [T('conifer', 120, [0x2a5846, 0x4a8a6a], { snow: 0xf4f8fc }), T('pillar', 18, [0xc4d4e2, 0xf0f6fc], { r: 2.5 }), S('bush', 40, [0xd8e6f2, 0xffffff]), S('rock', 55, [0x9db0c2, 0xdbe6f0]), G(0.55, [0xb4cadc, 0xf2f8fe], 0.4)],
  ],
  futuristic: [
    [T('pylon', 95, [0, 0], { glowCol: 0x4de3ff, r: 2.5 }), T('crystal', 60, [0x2aa8c8, 0xaaf4ff], { glowCol: 0x4de3ff, r: 2.5, size: [0.9, 1.6] }), S('rock', 50, [0x1c2840, 0x34486a]), { kind: 'shard', density: 0.2, pal: [0x2ab8d8, 0x9cf4ff], min: 3.0, grass: true, glowCol: 0x4de3ff }],
    [T('crystal', 140, [0xa02cc8, 0xff9af0], { glowCol: 0xff4de1, r: 2.2, size: [0.9, 1.9] }), T('pylon', 20, [0, 0], { glowCol: 0xff4de1 }), S('rock', 50, [0x2a1a3a, 0x4a2c5a]), { kind: 'shard', density: 0.16, pal: [0xc83ab0, 0xffa8f0], min: 3.0, grass: true, glowCol: 0xff4de1 }],
    [T('pylon', 70, [0, 0], { glowCol: 0xffb060, r: 2.5 }), S('crate', 28, [0x5a4a3a, 0x7a6048]), S('rock', 100, [0x4a2a1c, 0x7a4a32]), { kind: 'shard', density: 0.07, pal: [0xc87a30, 0xffc080], min: 3.0, grass: true, glowCol: 0xffb060 }],
    [T('crystal', 100, [0x3aa030, 0xc0ff9a], { glowCol: 0x7dff4d, r: 2.2, size: [0.8, 1.7] }), S('rock', 50, [0x1c2e1a, 0x3a5a34]), { kind: 'shard', density: 0.3, pal: [0x4ac838, 0xc8ff9c], min: 3.0, grass: true, glowCol: 0x7dff4d }],
    [T('pylon', 85, [0, 0], { glowCol: 0x9fe8ff, r: 2.5 }), T('crystal', 75, [0x8fc8e8, 0xf0fcff], { glowCol: 0x9fe8ff, r: 2.2, size: [0.9, 1.7] }), S('rock', 60, [0x7a96b2, 0xc8dcee]), { kind: 'shard', density: 0.12, pal: [0x9fd8f0, 0xffffff], min: 3.0, grass: true, glowCol: 0xbfeaff }],
    [T('crystal', 115, [0x6a30c8, 0xc89aff], { glowCol: 0xa05cff, r: 2.2, size: [0.9, 2.0] }), T('pylon', 22, [0, 0], { glowCol: 0xa05cff, r: 2.5 }), S('rock', 50, [0x14101e, 0x2e2848]), { kind: 'shard', density: 0.16, pal: [0x7a3ae0, 0xd0a8ff], min: 3.0, grass: true, glowCol: 0xa05cff }],
  ],
};

// ------------------------------------------------------------------ shared materials (wind lives in the vegetation ones)
// Bends vertices by their `aSway` weight, stipple-fades with distance (uFade = start, end), and optionally lets the vertex
// colour drive the glow (so a crystal can be dark at its base and bright at its tip).
function windMaterial(uniforms, { glow = 0, wind = true } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: glow ? 0.35 : 0.86, metalness: 0, emissive: glow ? 0xffffff : 0x000000, emissiveIntensity: glow });
  m.customProgramCacheKey = () => `wind${wind ? 1 : 0}${glow ? 'g' : ''}`;
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uWind = uniforms.uWind; sh.uniforms.uFade = uniforms.uFade;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway; uniform float uTime, uWind; varying float vCamDist;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float wph = instanceMatrix[3].x * .31 + instanceMatrix[3].z * .23;
        #else
          float wph = 0.;
        #endif
        float wv = sin(uTime * 1.7 + wph) * .6 + sin(uTime * 3.3 + wph * 2.3) * .4;
        transformed.x += wv * aSway * uWind; transformed.z += cos(uTime * 1.3 + wph) * aSway * uWind * .6;`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uFade; varying float vCamDist;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uFade.y > 0.) { float fa = 1. - smoothstep(uFade.x, uFade.y, vCamDist); float dn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))); if (fa < dn) discard; }`);
    if (glow) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
  };
  return m;
}
const fadeU = (wind, a, b, k) => ({ uTime: wind.uTime, uWind: { value: wind.uWind.value * k }, uFade: { value: new THREE.Vector2(a, b) } });

// ------------------------------------------------------------------ scatter + instancing
// ctx: { scene, heightAt, distToPath (any cheap approximation is fine), HALF, map, taken (resource nodes), keepOut: [{x,z,r}], wind, grassScale }
export const makeWind = fut => ({ uTime: { value: 0 }, uWind: { value: fut ? 0.05 : 0.16 }, uFade: { value: new THREE.Vector2(0, 0) } });
const CHUNK = 24, NEAR_FADE = [22, 36], FAR_FADE = [58, 86], NEAR_SHOW = 36 + 17, FAR_FROM = 29, FAR_SHOW = 86 + 17;

export function buildScenery(ctx) {
  const { scene, heightAt, distToPath, HALF, map, taken, keepOut, wind } = ctx, wl = ctx.waterLevel ?? -1e9;
  const R = mulberry(map.seed * 7919 + 17), recipe = RECIPES[map.era][map.idx % 6], fut = map.era === 'futuristic', gs = ctx.grassScale ?? 1;
  const uNear = fadeU(wind, NEAR_FADE[0], NEAR_FADE[1], 1.4), uFar = fadeU(wind, FAR_FADE[0], FAR_FADE[1], 1.4);
  const matVeg = windMaterial(wind), matGrassNear = windMaterial(uNear), matGrassFar = windMaterial(uFar);
  const matRock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  const matMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 });
  const group = new THREE.Group(); group.name = 'scenery';
  const placed = [], chunks = [];
  const mats = new THREE.Matrix4(), col = new THREE.Color();
  const slopeAt = (x, z) => Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;

  for (const item of recipe) {
    const builder = B[item.kind]; if (!builder) continue;
    const variants = item.grass ? 1 : 3, geos = [];
    for (let v = 0; v < variants; v++) geos.push(builder(R, item.pal, { h: item.h, trunk: item.trunk, snow: item.snow }));
    const spots = [];
    if (item.grass) { // jittered grid, thinned by a patchy density field
      const cell = 1 / Math.sqrt(item.density * gs), cols = Math.ceil((HALF * 2 - 8) / cell);
      for (let t = 0; t < cols * cols; t++) {
        const gi = t % cols, gj = (t / cols) | 0, x = -HALF + 4 + (gi + R()) * cell, z = -HALF + 4 + (gj + R()) * cell, r = R();
        const dens = 0.3 + 0.7 * clamp01(Math.sin(x * 0.07 + Math.cos(z * 0.05) * 2) * 0.5 + 0.5 + (hash(Math.floor(x / 6), Math.floor(z / 6), 3) - 0.5) * 0.6);
        if (r > dens || Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5) continue;
        if (distToPath(x, z) < item.min) continue;
        if (keepOut.some(k => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r)) continue;
        if (slopeAt(x, z) > 0.75 || heightAt(x, z) < wl + 0.1) continue;
        spots.push({ x, y: heightAt(x, z) - 0.03, z, s: 0.7 + R() * 0.8, rot: R() * 6.283, tx: (R() - 0.5) * 0.14, tz: (R() - 0.5) * 0.14, c: R() });
      }
    } else {
      for (let t = 0, n = 0; t < item.n * 9 && n < item.n; t++) {
        const x = (R() - 0.5) * (HALF * 2 - 12), z = (R() - 0.5) * (HALF * 2 - 12);
        if (distToPath(x, z) < item.min) continue;
        if (keepOut.some(k => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r)) continue;
        if (taken.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < (item.r + 1.2) ** 2)) continue;
        if (placed.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < (item.r + p.r) ** 2 * 0.55)) continue;
        if (slopeAt(x, z) > 0.85 || heightAt(x, z) < wl + 0.1) continue;
        spots.push({ x, y: heightAt(x, z) - 0.04, z, s: item.size[0] + R() * (item.size[1] - item.size[0]), rot: R() * 6.283, v: Math.floor(R() * variants), tx: (R() - 0.5) * 0.12, tz: (R() - 0.5) * 0.12, c: R() });
        placed.push({ x, z, r: item.r * Math.min(1.2, item.size[1]) }); n++;
      }
    }
    if (!spots.length) continue;
    // body and glow parts share the same transforms; `tier` picks the grass fade materials
    const makeMeshes = (list, geo, tag, tier, scale = 1) => {
      const meshes = [];
      const add = (g, mat, cast) => {
        const im = new THREE.InstancedMesh(g, mat, list.length); im.castShadow = cast && item.cast; im.receiveShadow = true; im.name = tag;
        list.forEach((sp, i) => {
          _e.set(sp.tx, sp.rot, sp.tz, 'XYZ'); mats.compose(_p.set(sp.x, sp.y, sp.z), _q.setFromEuler(_e), _s.setScalar(sp.s * scale)); im.setMatrixAt(i, mats);
          const k = 0.82 + sp.c * 0.36; col.setRGB(k * (0.95 + 0.1 * sp.c), k, k * (1.05 - 0.1 * sp.c)); im.setColorAt(i, col);
        });
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
        group.add(im); meshes.push(im);
      };
      if (geo.body) add(geo.body, item.kind === 'pylon' ? matMetal : ['rock', 'pillar', 'spike', 'crate'].includes(item.kind) ? matRock : item.grass ? (tier === 'far' ? matGrassFar : matGrassNear) : matVeg, true);
      if (geo.glow) {
        let gm;
        if (item.kind === 'pylon') gm = new THREE.MeshStandardMaterial({ color: item.glowCol, emissive: item.glowCol, emissiveIntensity: 1.8, roughness: 0.35 });
        else gm = windMaterial(item.grass ? (tier === 'far' ? uFar : uNear) : wind, { glow: item.kind === 'shard' ? 1.3 : 0.9 });
        add(geo.glow, gm, item.kind !== 'shard');
      }
      return meshes;
    };
    if (item.grass) {
      const buckets = new Map();
      for (const sp of spots) { const key = Math.floor((sp.x + HALF) / CHUNK) + ',' + Math.floor((sp.z + HALF) / CHUNK); (buckets.get(key) || buckets.set(key, []).get(key)).push(sp); }
      for (const [key, list] of buckets) {
        const [ci, cj] = key.split(',').map(Number), far = list.filter((_, i) => i % 6 === 0);
        chunks.push({ x: -HALF + (ci + 0.5) * CHUNK, z: -HALF + (cj + 0.5) * CHUNK, near: makeMeshes(list, geos[0], 'grass', 'near'), far: makeMeshes(far, geos[0], 'grass', 'far', 1.7) });
      }
    } else {
      const byV = new Map(); for (const sp of spots) (byV.get(sp.v) || byV.set(sp.v, []).get(sp.v)).push(sp);
      for (const [v, list] of byV) makeMeshes(list, geos[v], item.kind);
    }
  }
  scene.add(group);
  return {
    group, chunks,
    // per frame: hide grass chunks that are too far away to be seen anyway (the shader fades the rest out smoothly)
    update(cam) {
      for (const c of chunks) { const d = Math.hypot(c.x - cam.x, c.z - cam.z), nv = d < NEAR_SHOW, fv = d > FAR_FROM && d < FAR_SHOW; for (const m of c.near) m.visible = nv; for (const m of c.far) m.visible = fv; }
    },
  };
}

// ------------------------------------------------------------------ resource nodes (each one is a small Group so the game can shake / scale / hide it)
export function nodeMesh(era, type, rng, mats) {
  const g = new THREE.Group();
  const body = (parts, mat = mats.veg) => { const m = new THREE.Mesh(merge(parts), mat); g.add(m); return m; };
  const glowMat = (c, i) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.3, metalness: 0.1 });
  const glowVC = mats.glow; // vertex colours drive both the lit colour and the glow, so crystals can fade from dark roots to bright tips
  if (era === 'ancient') {
    if (type === 0) { // broadleaf tree
      body([cyl(0.55, 0.38, 3.6, 7, { color: 0x6b4423, ao: [0, 3.6, 0.6], tint: 0.08 }), box(0.18, 0.5, 0.06, { at: [0.2, 1.0, 0.5], rot: [0, 0.4, 0], color: 0xc9a06a }), // a pale axe scar marks it as choppable
        ico(2.3, 1, { at: [0, 5.1, 0], scale: [1, 1.15, 1], color: 0x2f8f3a, jitter: 0.55, seed: 2, ao: [2.6, 7.6, 0.55], sway: [2, 8, 0.4], tint: 0.14 }),
        ico(1.5, 1, { at: [1.5, 4.2, 0.4], color: 0x3c9f44, jitter: 0.4, seed: 4, ao: [2.6, 6, 0.55], sway: [2, 8, 0.4] }),
        ico(1.4, 1, { at: [-1.4, 4.3, -0.5], color: 0x2a8434, jitter: 0.4, seed: 6, ao: [2.6, 6, 0.55], sway: [2, 8, 0.4] })]);
    } else if (type === 1) { // grey boulders
      const parts = []; for (let i = 0; i < 3; i++) parts.push(ico(0.9 + rng() * 0.8, 1, { at: [(rng() - 0.5) * 2, 0.55, (rng() - 0.5) * 2], scale: [1.1, 0.8, 1], rot: [0, rng() * 6, 0], color: lerpHex(0x8e8e90, 0xb4b4b6, rng()), jitter: 0.32, seed: i * 3, ao: [-0.2, 1.8, 0.6], tint: 0.14 }));
      body(parts, mats.rock);
    } else if (type === 2) { // copper-bearing rock with glowing ore
      body([ico(1.6, 1, { at: [0, 1.1, 0], scale: [1.1, 0.9, 1], color: 0x6a4a3a, jitter: 0.4, seed: 3, ao: [-0.2, 2.8, 0.6], tint: 0.12 })], mats.rock);
      const ore = []; for (let i = 0; i < 5; i++) ore.push(oct(0.42 + rng() * 0.15, { at: [(rng() - 0.5) * 2.2, 0.9 + rng() * 1.5, (rng() - 0.5) * 2.2], rot: [rng() * 3, rng() * 3, 0], scale: [1, 1.4, 1], color: lerpHex(0xc8601e, 0xffa850, rng()), ao: [0.5, 3, 0.45] }));
      g.add(new THREE.Mesh(merge(ore), glowVC));
    } else { // gold vein
      body([ico(1.5, 1, { at: [0, 1.0, 0], scale: [1.1, 0.85, 1], color: 0x4a3c34, jitter: 0.4, seed: 5, ao: [-0.2, 2.6, 0.6], tint: 0.12 })], mats.rock);
      const ore = [oct(1.1, { at: [0, 3.0, 0], scale: [1, 1.5, 1], color: 0xffd84d, ao: [1.4, 4.6, 0.5] }), oct(0.55, { at: [0.9, 2.2, 0.4], rot: [0.5, 0.5, 0], scale: [1, 1.4, 1], color: 0xffe27a, ao: [1.4, 3.2, 0.55] }), oct(0.5, { at: [-0.8, 2.0, -0.3], rot: [0.2, 1, 0.4], scale: [1, 1.4, 1], color: 0xffc83a, ao: [1.2, 3, 0.55] })];
      g.add(new THREE.Mesh(merge(ore), glowVC));
    }
  } else {
    if (type === 0) { // scrap heap
      const parts = []; for (let i = 0; i < 6; i++) parts.push(box(0.9 + rng() * 1.1, 0.3 + rng() * 0.5, 0.9 + rng() * 1.1, { at: [(rng() - 0.5) * 2.2, i * 0.28, (rng() - 0.5) * 2.2], rot: [rng() * 0.6, rng() * 3, rng() * 0.6], color: lerpHex(0x8896a6, 0x5a4a44, rng() * 0.6), tint: 0.12 }));
      body(parts, mats.metal);
    } else if (type === 1) { // crystal cluster
      const parts = []; for (let i = 0; i < 5; i++) { const w = 0.35 + rng() * 0.3, h = 1.6 + rng() * 1.8, a = rng() * 6.283, r = rng() * 0.9; parts.push(cyl(w, w * 0.8, h * 0.75, 6, { at: [Math.cos(a) * r, 0, Math.sin(a) * r], rot: [(rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5], color: lerpHex(0x1f95b8, 0x9cf0ff, rng()), tint: 0.15, ao: [0, h, 0.35] }), cone(w * 0.8, h * 0.3, 6, { at: [Math.cos(a) * r, h * 0.75, Math.sin(a) * r], color: 0xd0fbff })); }
      g.add(new THREE.Mesh(merge(parts), glowVC));
    } else if (type === 2) { // circuit rack
      body([box(2.6, 3.2, 0.6, { color: 0x1f2a1f, tint: 0.04, ao: [0, 3.2, 0.7] }), box(2.8, 0.2, 0.8, { at: [0, 3.2, 0], color: 0x2a3a2a }), cyl(0.04, 0.04, 1, 4, { at: [0.9, 3.4, 0], color: 0x889988 })], mats.metal);
      const leds = []; for (let i = 0; i < 5; i++) leds.push(box(2.1, 0.1, 0.08, { at: [0, 0.35 + i * 0.58, 0.31], color: i % 2 ? 0x6dff8f : 0x9affb0 }));
      g.add(new THREE.Mesh(merge(leds), glowVC));
    } else { // plasma core on a pedestal
      body([cyl(1.4, 1.0, 0.8, 8, { color: 0x2a2a3a, ao: [0, 0.8, 0.6] }), cyl(0.3, 0.3, 1.3, 6, { at: [0, 0.8, 0], color: 0x3a3a52 })], mats.metal);
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 12), glowMat(0xff4de1, 1.3)); s.position.y = 2.7; g.add(s);
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.12, 8, 28), glowMat(0xffffff, 0.8)); r.position.y = 2.7; r.rotation.x = 1.2; g.add(r);
    }
  }
  return g;
}

export function nodeMaterials(uniforms) {
  return { veg: windMaterial(uniforms), glow: windMaterial(uniforms, { glow: 0.95, wind: false }), rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }) };
}
