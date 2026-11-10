// The world beyond the play area: a ground plane that runs off into the haze plus a ring of distant mountains, dunes, volcanoes
// or city skylines (per map), so the menu backdrop is not a plate floating in fog and views over the rim have depth.
import * as THREE from 'three';
import { mulberry } from './data.js';
import { piece, box, cone, merge, glowMaterial } from './props.js';

// kind: hills | dunes | peaks | cones | city | spires.  lo/hi = colour at the foot / top, h = height, snow = white caps, glow = emissive accent
const STYLES = {
  ancient: [
    { kind: 'hills', lo: 0x5a9a52, hi: 0x3f7a46, h: 30 }, { kind: 'dunes', lo: 0xd2b070, hi: 0xe8cc94, h: 24 }, { kind: 'peaks', lo: 0x6a6e76, hi: 0x9aa0aa, h: 62 },
    { kind: 'hills', lo: 0x2a5a3a, hi: 0x1c4a2c, h: 44 }, { kind: 'cones', lo: 0x1a1412, hi: 0x3a2a24, h: 92, glow: 0xff5a1e }, { kind: 'peaks', lo: 0x9aaabb, hi: 0xf4f8ff, h: 78, snow: true },
  ],
  futuristic: [
    { kind: 'city', lo: 0x0a1a30, hi: 0x1c3c60, h: 64, glow: 0x4de3ff }, { kind: 'spires', lo: 0x2a103a, hi: 0x7a2a9a, h: 74, glow: 0xff4de1 }, { kind: 'city', lo: 0x2a1408, hi: 0x6a3418, h: 52, glow: 0xffb060 },
    { kind: 'spires', lo: 0x0a2008, hi: 0x2c6a22, h: 62, glow: 0x7dff4d }, { kind: 'peaks', lo: 0x7a96b2, hi: 0xeaf6ff, h: 72, snow: true }, { kind: 'city', lo: 0x08060f, hi: 0x241e3c, h: 74, glow: 0xa05cff },
  ],
};

const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (h2(xi, yi) * (1 - u) + h2(xi + 1, yi) * u) * (1 - v) + (h2(xi, yi + 1) * (1 - u) + h2(xi + 1, yi + 1) * u) * v; };
const fbm = (x, y) => vn(x, y) * 0.55 + vn(x * 2.1 + 5, y * 2.1) * 0.28 + vn(x * 4.3, y * 4.3 + 9) * 0.17;

export function buildHorizon(map, look, scene) {
  const st = STYLES[map.era][map.idx % 6], R = mulberry(map.seed * 13 + 7), th = map.theme, group = new THREE.Group(); group.name = 'horizon';
  const haze = new THREE.Color(look.horizon), c = new THREE.Color(), lo = new THREE.Color(st.lo), hi = new THREE.Color(st.hi);
  // ---- ground running out to the horizon: a plane with a hole under the terrain plate, so it can never show through a deep hollow
  const shape = new THREE.Shape(); shape.absarc(0, 0, 1500, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.moveTo(-87, -87); hole.lineTo(87, -87); hole.lineTo(87, 87); hole.lineTo(-87, 87); hole.closePath(); shape.holes.push(hole);
  const ground = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(th.g1).lerp(haze, 0.35).multiplyScalar(0.8), roughness: 1, metalness: 0 }));
  ground.position.y = -1.6; ground.userData.noShadow = true; group.add(ground);
  // ---- the ring
  if (st.kind === 'city' || st.kind === 'spires') {
    const parts = [], glow = [], N = st.kind === 'city' ? 230 : 150;
    for (let i = 0; i < N; i++) {
      const a = R() * 6.283, r = 175 + R() * 150, w = st.kind === 'city' ? 5 + R() * 11 : 3 + R() * 6, h = st.h * (0.25 + 0.75 * Math.pow(R(), 1.6)) * (0.6 + 0.4 * Math.sin(a * 3 + 1) ** 2), x = Math.cos(a) * r, z = Math.sin(a) * r, t = R();
      c.copy(lo).lerp(hi, t * 0.8).lerp(haze, 0.25 + 0.4 * (r - 175) / 150);
      if (st.kind === 'city') {
        parts.push(box(w, h, w * (0.7 + R() * 0.6), { at: [x, -1.6, z], rot: [0, a + R() * 0.3, 0], color: c.getHex(), tint: 0.06, ao: [-1.6, h * 0.8, 0.7] }));
        if (h > 14 && R() < 0.7) glow.push(box(w * 1.02, 0.5 + R() * 0.8, w * 0.72, { at: [x, -1.6 + h * (0.3 + R() * 0.6), z], rot: [0, a, 0], color: new THREE.Color(st.glow).lerp(haze, 0.3).getHex() }));
      } else {
        parts.push(cone(w, h, 5, { at: [x, -1.6, z], color: c.getHex(), jitter: 0.5, seed: i, ao: [-1.6, h, 0.6], tint: 0.1 }));
        if (R() < 0.45) glow.push(cone(w * 0.28, h * 0.55, 5, { at: [x, -1.6 + h * 0.7, z], color: new THREE.Color(st.glow).lerp(haze, 0.25).getHex() }));
      }
    }
    const m = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.2 })); m.userData.noShadow = true; group.add(m);
    if (glow.length) { const g = new THREE.Mesh(merge(glow), glowMaterial(1.1)); g.userData.noShadow = true; g.material.fog = true; group.add(g); }
  } else {
    const A = 200, RR = 8, r0 = 150, r1 = 440, pos = [], col = [], idx = [], seed = R() * 100;
    const cones = []; for (let i = 0; i < 5; i++) cones.push({ a: R() * 6.283, w: 0.08 + R() * 0.06 });
    for (let j = 0; j <= RR; j++) for (let i = 0; i <= A; i++) {
      const a = (i / A) * 6.283, rt = j / RR, r = r0 + (r1 - r0) * rt, nx = Math.cos(a) * 2.4 + seed, ny = Math.sin(a) * 2.4;
      const bell = Math.pow(Math.sin(Math.PI * Math.min(1, rt * 1.12)), 0.9), n = fbm(nx, ny + rt * 1.4);
      let hgt;
      if (st.kind === 'dunes') hgt = st.h * (0.2 + 0.8 * n) * bell;
      else if (st.kind === 'hills') hgt = st.h * (0.3 + 0.9 * n * n) * bell;
      else if (st.kind === 'peaks') hgt = st.h * (0.2 + 1.1 * Math.pow(1 - Math.abs(2 * fbm(nx * 1.3, ny * 1.3 + rt * 2) - 1), 2.2)) * bell;
      else { let k = 0; for (const c2 of cones) { let d = Math.abs(a - c2.a); d = Math.min(d, 6.283 - d); k = Math.max(k, Math.exp(-(d * d) / (c2.w * c2.w))); } hgt = st.h * (0.18 * n + 0.95 * k * (0.7 + 0.3 * n)) * bell; }
      pos.push(Math.cos(a) * r, -1.6 + hgt, Math.sin(a) * r);
      const f = Math.min(1, hgt / st.h);
      c.copy(lo).lerp(hi, f);
      if (st.snow && f > 0.5) c.lerp(new THREE.Color(0xffffff), Math.min(1, (f - 0.5) * 3));
      if (st.glow && f > 0.8) c.lerp(new THREE.Color(st.glow), (f - 0.8) * 4);
      c.lerp(haze, 0.22 + 0.45 * rt); col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < RR; j++) for (let i = 0; i < A; i++) { const a = j * (A + 1) + i, b = a + 1, d = a + A + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true })); m.userData.noShadow = true; group.add(m);
  }
  scene.add(group);
  return group;
}
