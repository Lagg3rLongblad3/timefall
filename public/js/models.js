// Tower and enemy models, built from the faceted kit in props.js: static parts of each model are merged into one or
// two vertex-coloured meshes (plus a glow mesh); animated parts keep their names (see towers.js / game.js).
// Every tower faces +Z; userData.head rotates to aim, userData.arm swings on the catapult.
import * as THREE from 'three';
import { piece, merge, cyl, cone, box, ico, oct, glowMaterial } from './props.js';

const std = (metal = 0, rough = 0.78) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
const named = (o, n) => { o.name = n; return o; };
const tor = (R, r, o) => piece(new THREE.TorusGeometry(R, r, 6, 22), o);
const sph = (r, o) => ico(r, 2, o);
const dome = (r, o) => piece(new THREE.SphereGeometry(r, 9, 5, 0, 6.283, 0, 1.45), o);
const limb = (r0, r1, h, o) => piece(new THREE.CylinderGeometry(r0, r1, h, 6).translate(0, -h / 2, 0), o);   // hangs DOWN from its pivot
const rod = (a, b, r, o = {}) => { // a thin box between two points
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
  return box(r, r, L, { ...o, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - r / 2, (a[2] + b[2]) / 2], rot: [-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0], order: 'YXZ' });
};

// A pile of parts by material; `into` turns it into up to three merged meshes.
export class Kit {
  constructor() { this.b = []; this.m = []; this.g = []; }
  body(...p) { this.b.push(...p); return this; }
  metal(...p) { this.m.push(...p); return this; }
  glow(...p) { this.g.push(...p); return this; }
  into(group, glowI = 1, metalRough = 0.35) {
    if (this.b.length) group.add(new THREE.Mesh(merge(this.b), std(0, 0.8)));
    if (this.m.length) group.add(new THREE.Mesh(merge(this.m), std(0.75, metalRough)));
    if (this.g.length) group.add(new THREE.Mesh(merge(this.g), glowMaterial(glowI)));
    return group;
  }
}
const part = (kit, name, at = [0, 0, 0], glowI = 1) => { const g = new THREE.Group(); g.name = name; g.position.set(...at); return kit.into(g, glowI); }; // a named, animatable group
const glowPart = (name, geo, at, glowI = 1, rot) => { const m = named(new THREE.Mesh(merge(geo), glowMaterial(glowI)), name); m.position.set(...at); if (rot) m.rotation.set(...rot); return m; }; // a named glowing mesh

const WOOD = 0x8a5a2e, WOOD2 = 0x5a3a1f, STONE = 0xb4ad9c, STONE2 = 0x8e8878, IRON = 0x3a3f4a, STEEL = 0x9aa6b4, BRONZE = 0xc98a3c, GOLD = 0xe6c36a;

export function towerModel(id) {
  const g = new THREE.Group(), head = new THREE.Group(); head.position.y = 0; g.add(head); g.userData.head = head;
  const S = new Kit(), H = new Kit();
  switch (id) {
    case 'ballista':
      S.body(cyl(1.9, 1.6, 0.5, 8, { color: STONE2, tint: 0.06, ao: [0, 0.5, 0.7] }), cyl(0.55, 0.45, 1.0, 8, { at: [0, 0.5, 0], color: WOOD2, ao: [0.5, 1.5, 0.7] }), box(0.5, 0.3, 0.5, { at: [1.1, 0.5, 0.5], color: STONE, rot: [0, 0.5, 0] }))
        .metal(cyl(0.72, 0.72, 0.16, 10, { at: [0, 1.45, 0], color: IRON }));
      H.body(box(0.5, 0.4, 3.4, { at: [0, 1.45, 0.2], color: WOOD, tint: 0.08 }), box(0.3, 0.2, 2.8, { at: [0, 1.85, 0.5], color: WOOD2 }), box(0.7, 0.55, 0.5, { at: [0, 1.4, -1.55], color: WOOD2 }));
      for (const s of [-1, 1]) H.body(box(1.9, 0.22, 0.3, { at: [s * 1.0, 1.6, 1.05], rot: [0, -s * 0.28, 0], color: WOOD2 }), box(1.0, 0.2, 0.26, { at: [s * 2.0, 1.6, 1.5], rot: [0, s * 0.55, 0], color: WOOD2 }));
      H.metal(rod([-2.45, 1.7, 1.75], [0, 1.95, -0.6], 0.06, { color: 0xd8d2c0 }), rod([2.45, 1.7, 1.75], [0, 1.95, -0.6], 0.06, { color: 0xd8d2c0 }), rod([0, 2.0, -0.7], [0, 2.0, 1.85], 0.13, { color: STEEL }), cone(0.22, 0.6, 6, { at: [0, 2.0, 1.85], rot: [Math.PI / 2, 0, 0], color: 0xdfe6ee }),
        cyl(0.3, 0.3, 0.8, 8, { at: [0.4, 1.4, -1.55], rot: [0, 0, Math.PI / 2], color: IRON }), box(0.6, 0.12, 0.5, { at: [0, 1.62, 0.3], color: IRON }), box(0.6, 0.12, 0.5, { at: [0, 1.62, 1.2], color: IRON }));
      break;
    case 'catapult': {
      S.body(box(0.38, 0.38, 4.4, { at: [-1.15, 0.9, 0], color: WOOD }), box(0.38, 0.38, 4.4, { at: [1.15, 0.9, 0], color: WOOD }), box(2.9, 0.3, 0.34, { at: [0, 0.95, 1.5], color: WOOD2 }), box(2.9, 0.3, 0.34, { at: [0, 0.95, -1.5], color: WOOD2 }));
      for (const [x, z] of [[-1.6, 1.3], [1.6, 1.3], [-1.6, -1.3], [1.6, -1.3]]) S.body(cyl(0.9, 0.9, 0.34, 12, { at: [x + 0.17, 0.9, z], rot: [0, 0, Math.PI / 2], color: WOOD2, tint: 0.05 })).metal(cyl(0.22, 0.22, 0.46, 8, { at: [x + 0.23, 0.9, z], rot: [0, 0, Math.PI / 2], color: IRON }));
      H.body(box(0.4, 1.9, 0.4, { at: [-1.0, 1.0, 0], color: WOOD }), box(0.4, 1.9, 0.4, { at: [1.0, 1.0, 0], color: WOOD }), box(2.4, 0.3, 0.3, { at: [0, 2.7, 0], color: WOOD2 }));
      const arm = new THREE.Group(); arm.position.set(0, 2.2, 0); arm.rotation.x = -0.35;
      new Kit().body(box(0.38, 0.38, 4.6, { at: [0, -0.1, -0.4], color: WOOD, tint: 0.06 }), box(1.1, 0.35, 0.9, { at: [0, 0.1, -2.5], color: WOOD2 }), box(1.1, 0.7, 1.1, { at: [0, -0.5, 1.9], color: 0x6a665c, tint: 0.1 }), ico(0.82, 1, { at: [0, 0.85, -2.45], color: 0x6a5a4a, jitter: 0.25, seed: 3, tint: 0.14 }))
        .metal(box(0.5, 0.12, 0.5, { at: [0, 0.1, 0], color: IRON }), box(0.14, 0.14, 1.4, { at: [0, 0.0, -2.0], color: IRON })).into(arm);
      head.add(arm); g.userData.arm = arm;
      break; }
    case 'brazier':
      for (let i = 0; i < 3; i++) { const a = i * 2.09; S.body(rod([Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2], [Math.cos(a) * 0.45, 2.1, Math.sin(a) * 0.45], 0.22, { color: WOOD2 })); }
      S.metal(cyl(0.85, 1.5, 0.95, 12, { at: [0, 1.8, 0], color: BRONZE, tint: 0.05, ao: [1.8, 2.7, 0.7] }), tor(1.5, 0.12, { at: [0, 2.72, 0], rot: [Math.PI / 2, 0, 0], color: 0xe6a850 }), tor(0.9, 0.08, { at: [0, 2.0, 0], rot: [Math.PI / 2, 0, 0], color: 0x8a5a24 }))
        .glow(cyl(1.1, 1.3, 0.12, 10, { at: [0, 2.7, 0], color: 0xff5a1a }));
      g.add(glowPart('flame', [cone(0.88, 2.5, 7, { color: 0xff6a14, ao: [0, 2.5, 0.35], jitter: 0.12 })], [0, 2.75, 0], 1.5), glowPart('flame2', [cone(0.5, 1.8, 7, { color: 0xffd23a, ao: [0, 1.8, 0.5], jitter: 0.1 })], [0, 2.75, 0], 1.7));
      break;
    case 'totem':
      S.body(box(2.0, 1.1, 2.0, { color: STONE2, tint: 0.08, ao: [0, 1.1, 0.7] }), box(1.55, 1.35, 1.55, { at: [0, 1.1, 0], color: 0x9fb4c0, tint: 0.08 }), box(1.15, 1.15, 1.15, { at: [0, 2.45, 0], color: 0x8ea4b2, tint: 0.08 }), box(1.5, 0.22, 1.5, { at: [0, 3.55, 0], color: STONE, rot: [0, 0.4, 0] }));
      for (let i = 0; i < 5; i++) { const a = i * 1.26; S.body(cone(0.28, 0.9 + (i % 2) * 0.5, 5, { at: [Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55], rot: [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25], color: 0xc8ecff, tint: 0.1 })); }
      S.glow(box(0.3, 0.3, 0.1, { at: [-0.32, 3.0, 0.56], color: 0x7fd8ff }), box(0.3, 0.3, 0.1, { at: [0.32, 3.0, 0.56], color: 0x7fd8ff }), box(0.7, 0.14, 0.1, { at: [0, 1.7, 0.78], color: 0x6fc8ee }), box(0.1, 0.5, 0.1, { at: [0, 1.4, 0.78], color: 0x6fc8ee }));
      g.add(glowPart('spin', [oct(0.62, { scale: [1, 1.5, 1], color: 0xc8f2ff })], [0, 4.7, 0], 1.3), glowPart('ringflat', [tor(1.6, 0.07, { color: 0x9fe4ff })], [0, 0.3, 0], 1.1, [Math.PI / 2, 0, 0]));
      break;
    case 'obelisk':
      S.body(cyl(2.3, 2.1, 0.5, 4, { color: STONE, rot: [0, Math.PI / 4, 0], tint: 0.06 }), cyl(1.8, 1.5, 0.45, 4, { at: [0, 0.5, 0], color: STONE2, rot: [0, Math.PI / 4, 0] }), cyl(1.1, 0.55, 4.9, 4, { at: [0, 0.9, 0], color: 0x3a3060, rot: [0, Math.PI / 4, 0], ao: [0.9, 5.8, 0.65], tint: 0.06 }), cone(0.56, 0.6, 4, { at: [0, 5.8, 0], rot: [0, Math.PI / 4, 0], color: 0x4a3f78 }));
      for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.785; S.glow(box(0.1, 0.9, 0.06, { at: [Math.cos(a) * 0.62, 1.7, Math.sin(a) * 0.62], rot: [0, -a + 1.5708, 0], color: 0xb8a6ff }), box(0.1, 0.9, 0.06, { at: [Math.cos(a) * 0.48, 3.0, Math.sin(a) * 0.48], rot: [0, -a + 1.5708, 0], color: 0xd0c0ff })); }
      g.add(glowPart('spin', [oct(0.7, { scale: [1, 1.5, 1], color: 0xd8ccff })], [0, 6.4, 0], 1.5), glowPart('spin2', [tor(1.1, 0.07, { color: 0xb8a6ff })], [0, 4.2, 0], 1.3, [Math.PI / 2, 0, 0]));
      break;
    case 'sphinx':
      S.body(box(3.6, 0.5, 4.4, { color: STONE2, tint: 0.06 }), box(3.2, 0.2, 4.0, { at: [0, 0.5, 0], color: STONE }));
      H.body(box(1.9, 1.25, 3.1, { at: [0, 0.7, -0.1], color: GOLD, tint: 0.06, ao: [0.7, 2, 0.75] }), box(0.7, 0.55, 1.6, { at: [-0.62, 0.7, 2.0], color: 0xd8b45a }), box(0.7, 0.55, 1.6, { at: [0.62, 0.7, 2.0], color: 0xd8b45a }),
        box(1.15, 1.05, 1.1, { at: [0, 1.9, 1.25], color: 0xe9c978, tint: 0.05 }), box(1.75, 1.4, 0.5, { at: [0, 1.8, 0.8], color: 0x2a5aa0, tint: 0.05 }), box(0.34, 1.0, 0.7, { at: [-0.78, 1.5, 1.1], color: 0x2a5aa0 }), box(0.34, 1.0, 0.7, { at: [0.78, 1.5, 1.1], color: 0x2a5aa0 }),
        box(0.22, 1.7, 2.1, { at: [-1.15, 0.9, -0.5], rot: [0, 0, -0.2], color: 0xc9a54a }), box(0.22, 1.7, 2.1, { at: [1.15, 0.9, -0.5], rot: [0, 0, 0.2], color: 0xc9a54a }), box(0.45, 0.3, 0.45, { at: [0, 2.9, 1.25], color: 0x2a5aa0 }));
      H.metal(box(1.5, 0.12, 0.12, { at: [0, 1.62, 1.82], color: GOLD }), box(1.15, 0.1, 0.1, { at: [0, 1.0, 1.82], color: GOLD }))
        .glow(box(0.26, 0.2, 0.1, { at: [-0.28, 2.08, 1.82], color: 0xff3030 }), box(0.26, 0.2, 0.1, { at: [0.28, 2.08, 1.82], color: 0xff3030 }));
      break;
    // ------------------------------------------------------------ futuristic
    case 'laser':
      S.metal(cyl(1.7, 1.3, 0.95, 8, { color: 0x2b3447, ao: [0, 1, 0.7] }), cyl(0.9, 0.7, 0.55, 8, { at: [0, 0.95, 0], color: IRON })).glow(tor(1.45, 0.07, { at: [0, 0.55, 0], rot: [Math.PI / 2, 0, 0], color: 0xff4d4d }));
      H.metal(box(1.4, 1.0, 1.9, { at: [0, 1.2, -0.1], color: 0x8896a6, tint: 0.05 }), cyl(0.3, 0.26, 1.5, 8, { at: [0, 1.7, 0.7], rot: [Math.PI / 2, 0, 0], color: 0x2b3447 }), cyl(0.42, 0.42, 0.5, 8, { at: [0, 1.7, 0.95], rot: [Math.PI / 2, 0, 0], color: IRON }), box(1.5, 0.12, 1.0, { at: [0, 2.2, -0.5], color: IRON }))
        .glow(ico(0.3, 1, { at: [0, 1.7, 2.0], color: 0xff6a6a }), box(1.2, 0.14, 0.3, { at: [0, 2.28, -0.3], color: 0xff4d4d }), box(0.08, 0.5, 0.9, { at: [-0.72, 1.45, -0.1], color: 0xff4d4d }), box(0.08, 0.5, 0.9, { at: [0.72, 1.45, -0.1], color: 0xff4d4d }));
      break;
    case 'railgun':
      S.metal(cyl(1.8, 1.4, 1.0, 6, { color: 0x2b3447, ao: [0, 1, 0.7] }), cyl(1.0, 0.9, 0.5, 6, { at: [0, 1, 0], color: IRON }));
      H.metal(box(1.2, 1.1, 2.1, { at: [0, 1.35, -0.4], color: 0x8896a6, tint: 0.05 }), box(0.34, 0.36, 5.8, { at: [-0.34, 1.45, 1.6], color: 0x3a4a66 }), box(0.34, 0.36, 5.8, { at: [0.34, 1.45, 1.6], color: 0x3a4a66 }), box(1.4, 0.2, 0.9, { at: [0, 2.5, -0.5], color: IRON }));
      H.glow(box(0.1, 0.44, 5.6, { at: [-0.16, 1.43, 1.6], color: 0x6fb7ff }), box(0.1, 0.44, 5.6, { at: [0.16, 1.43, 1.6], color: 0x6fb7ff }));
      for (let i = 0; i < 4; i++) H.glow(tor(0.5, 0.08, { at: [0, 1.63, 0.6 + i * 1.2], color: 0x9fd0ff }));
      break;
    case 'tesla':
      S.metal(cyl(1.8, 1.5, 0.8, 8, { color: 0x2b3447, ao: [0, 0.8, 0.7] }), cyl(1.2, 0.9, 1.6, 8, { at: [0, 0.8, 0], color: 0x8896a6, ao: [0.8, 2.4, 0.7] }), cyl(0.8, 0.6, 1.5, 8, { at: [0, 2.4, 0], color: 0x7a889a }), cyl(0.5, 0.4, 0.5, 8, { at: [0, 3.9, 0], color: IRON }))
        .glow(tor(1.1, 0.1, { at: [0, 2.2, 0], rot: [Math.PI / 2, 0, 0], color: 0xa9f1ff }), tor(0.85, 0.1, { at: [0, 3.5, 0], rot: [Math.PI / 2, 0, 0], color: 0xa9f1ff }));
      g.add(glowPart('orb', [sph(0.9, { color: 0xc8f6ff })], [0, 4.7, 0], 1.5));
      break;
    case 'gravity':
      S.metal(cyl(2.0, 1.6, 0.6, 8, { color: 0x2b3447, ao: [0, 0.6, 0.7] }), cyl(0.5, 0.4, 1.4, 6, { at: [0, 0.6, 0], color: IRON }), sph(0.95, { at: [0, 2.6, 0], color: 0x120a22 }));
      g.add(glowPart('spin', [tor(1.5, 0.12, { color: 0xa05cff })], [0, 2.6, 0], 1.3, [Math.PI / 2, 0, 0]), glowPart('spin2', [tor(1.95, 0.08, { color: 0xd0a0ff })], [0, 2.6, 0], 1.1, [1.0, 0, 0.5]));
      break;
    case 'hive':
      S.metal(cyl(2.3, 1.9, 1.4, 6, { color: 0x8896a6, tint: 0.05, ao: [0, 1.4, 0.7] }), cyl(1.3, 0.9, 0.5, 6, { at: [0, 1.4, 0], color: IRON }), box(0.14, 1.0, 0.14, { at: [0, 2.4, 0], color: IRON })).body(dome(1.35, { at: [0, 1.4, 0], color: 0x3a5a46 }))
        .glow(box(0.3, 0.3, 0.3, { at: [0, 3.4, 0], color: 0x6dff8f }), tor(2.05, 0.06, { at: [0, 0.9, 0], rot: [Math.PI / 2, 0, 0], color: 0x6dff8f }));
      for (let i = 0; i < 3; i++) g.add(glowPart('drone' + i, [oct(0.45, { color: 0x9affb0 }), box(1.0, 0.05, 0.14, { at: [0, 0.1, 0], color: 0x3a4a44 })], [0, 4, 0], 1.2));
      break;
    case 'nova':
      S.metal(cyl(2.0, 1.5, 1.0, 8, { color: 0x2b3447, ao: [0, 1, 0.7] }), cyl(0.7, 0.6, 0.9, 8, { at: [0, 1.0, 0], color: IRON })).glow(tor(1.75, 0.07, { at: [0, 0.55, 0], rot: [Math.PI / 2, 0, 0], color: 0xff4de1 }));
      g.add(glowPart('core', [sph(1.1, { color: 0xff7aea })], [0, 3, 0], 1.2), glowPart('spin', [tor(1.8, 0.1, { color: 0xffffff })], [0, 3, 0], 0.9), glowPart('spin2', [tor(2.1, 0.08, { color: 0xff4de1 })], [0, 3, 0], 1.0, [0, 1.2, 0]));
      break;
  }
  S.into(g); H.into(head);
  return g;
}

// ------------------------------------------------------------------ enemies
// Faces +Z. Limb groups named legL/legR/armL/armR (pivot at hip/shoulder) are swung by animateEnemy(); 'rotor' spins.
export function enemyModel(era, type) {
  const g = new THREE.Group();
  const SK = 0xd9a27a;
  const addLimbs = (legs, arms) => { for (const l of legs) g.add(l); for (const a of arms) g.add(a); };
  const leg = (name, x, y, h, r, color, extra) => { const K = new Kit(); K.body(limb(r, r * 0.78, h, { color, tint: 0.05, ao: [-h, 0, 0.8] })); if (extra) extra(K); return part(K, name, [x, y, 0]); };
  const arm = (name, x, y, h, r, color, extra) => { const K = new Kit(); K.body(limb(r, r * 0.8, h, { color, tint: 0.05 })); if (extra) extra(K); return part(K, name, [x, y, 0]); };
  if (era === 'ancient') {
    switch (type) {
      case 'grunt': { const K = new Kit();
        K.body(cyl(0.44, 0.34, 0.95, 7, { at: [0, 0.75, 0], color: 0x8a5a2a, tint: 0.06, ao: [0.75, 1.7, 0.7] }), cyl(0.45, 0.45, 0.12, 7, { at: [0, 0.98, 0], color: 0x3a2a1a }), sph(0.27, { at: [0, 1.88, 0], color: SK }), box(0.3, 0.08, 0.04, { at: [0, 1.9, 0.26], color: 0x2a1a10 }), box(0.5, 0.3, 0.16, { at: [0, 1.5, -0.3], color: 0x7a2a22 }))
          .metal(dome(0.3, { at: [0, 1.9, 0], color: BRONZE }), box(0.07, 0.22, 0.5, { at: [0, 2.2, 0], color: 0xb02020 }), cyl(0.3, 0.3, 0.05, 8, { at: [0, 1.9, 0], color: 0xa87030 }));
        g.add(K.into(new THREE.Group()));
        addLimbs([leg('legL', -0.17, 0.75, 0.75, 0.16, SK, k => k.body(box(0.24, 0.1, 0.36, { at: [0, -0.78, 0.06], color: 0x4a3020 }))), leg('legR', 0.17, 0.75, 0.75, 0.16, SK, k => k.body(box(0.24, 0.1, 0.36, { at: [0, -0.78, 0.06], color: 0x4a3020 })))],
          [arm('armL', -0.5, 1.4, 0.65, 0.1, SK, k => k.body(cyl(0.46, 0.46, 0.07, 12, { at: [-0.14, -0.55, 0.12], rot: [0, 0, Math.PI / 2], color: 0xb02020 })).metal(ico(0.14, 1, { at: [-0.19, -0.55, 0.12], color: BRONZE }))),
           arm('armR', 0.5, 1.4, 0.65, 0.1, SK, k => k.body(cyl(0.04, 0.04, 2.5, 5, { at: [0, -0.9, 0.18], color: 0x6a4a2a })).metal(cone(0.09, 0.4, 5, { at: [0, 1.6, 0.18], color: STEEL })))]);
        break; }
      case 'runner': { const K = new Kit();
        K.body(cyl(0.34, 0.24, 0.95, 7, { at: [0, 0.8, 0.05], rot: [0.3, 0, 0], color: 0x3a7a4a, tint: 0.06 }), sph(0.24, { at: [0, 1.7, 0.3], color: SK }), box(0.5, 0.1, 0.1, { at: [0, 1.82, 0.3], color: 0xc03030 }), box(0.1, 0.12, 0.5, { at: [0, 1.75, -0.1], color: 0xc03030 }));
        g.add(K.into(new THREE.Group()));
        addLimbs([leg('legL', -0.14, 0.82, 0.85, 0.12, SK), leg('legR', 0.14, 0.82, 0.85, 0.12, SK)], [arm('armL', -0.36, 1.4, 0.6, 0.08, SK), arm('armR', 0.36, 1.4, 0.6, 0.08, SK)]);
        break; }
      case 'brute': { const K = new Kit();
        K.body(box(1.25, 1.25, 0.85, { at: [0, 1.0, 0], color: 0x7a3a2a, tint: 0.06, ao: [1, 2.3, 0.75] }), box(1.3, 0.35, 0.9, { at: [0, 0.8, 0], color: 0x4a3020 }), sph(0.42, { at: [0, 2.55, 0.1], color: SK }), box(0.2, 0.12, 0.1, { at: [-0.14, 2.65, 0.5], color: 0x2a1a10 }), box(0.2, 0.12, 0.1, { at: [0.14, 2.65, 0.5], color: 0x2a1a10 }))
          .metal(dome(0.5, { at: [0, 2.6, 0.1], color: 0x707880 }), cone(0.13, 0.6, 5, { at: [-0.5, 2.8, 0.1], rot: [0, 0, 0.7], color: 0xf0e8d0 }), cone(0.13, 0.6, 5, { at: [0.5, 2.8, 0.1], rot: [0, 0, -0.7], color: 0xf0e8d0 }), box(1.4, 0.2, 0.4, { at: [0, 2.2, 0], color: 0x6a5a4a }));
        g.add(K.into(new THREE.Group()));
        addLimbs([leg('legL', -0.36, 0.95, 0.95, 0.24, 0x6a4a3a), leg('legR', 0.36, 0.95, 0.95, 0.24, 0x6a4a3a)],
          [arm('armL', -0.85, 1.95, 1.1, 0.2, SK), arm('armR', 0.85, 1.95, 1.1, 0.2, SK, k => k.body(cyl(0.13, 0.2, 1.4, 6, { at: [0, -1.5, 0.3], rot: [0.5, 0, 0], color: 0x6a4a2a })).metal(ico(0.3, 1, { at: [0, -0.35, 0.85], color: 0x8a8a90, jitter: 0.12 })))]);
        break; }
      case 'swarm': { const K = new Kit();
        K.metal(piece(new THREE.SphereGeometry(0.4, 9, 6, 0, 6.283, 0, 1.6), { at: [0, 0.3, 0], scale: [1, 0.75, 1.35], color: 0x1a2a3a, tint: 0.1 }))
          .glow(ico(0.1, 1, { at: [-0.14, 0.42, 0.5], color: 0x2affd0 }), ico(0.1, 1, { at: [0.14, 0.42, 0.5], color: 0x2affd0 }), box(0.04, 0.02, 0.7, { at: [0, 0.62, 0], color: 0x2a6a7a }));
        g.add(K.into(new THREE.Group(), 1.4));
        const ls = []; for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const K2 = new Kit(); K2.body(limb(0.04, 0.03, 0.4, { color: 0x101a24 })); const l = part(K2, s < 0 ? 'legL' : 'legR', [s * 0.3, 0.28, -0.25 + i * 0.28]); l.rotation.z = s * 0.9; ls.push(l); }
        addLimbs(ls, []);
        break; }
      case 'boss': { const K = new Kit();
        K.body(box(2.0, 2.1, 1.4, { at: [0, 1.9, 0], color: 0x4a2a20, tint: 0.07, ao: [1.9, 4, 0.7] }), box(2.1, 0.45, 1.5, { at: [0, 1.6, 0], color: 0x2a1a14 }), box(1.1, 1.0, 1.1, { at: [0, 3.9, 0.3], color: 0x5a3a2a, tint: 0.05 }), box(0.7, 0.55, 0.6, { at: [0, 3.75, 0.95], color: 0x6a4a3a }))
          .metal(box(0.8, 0.5, 0.9, { at: [-1.35, 3.8, 0], color: BRONZE }), box(0.8, 0.5, 0.9, { at: [1.35, 3.8, 0], color: BRONZE }), cone(0.22, 1.3, 6, { at: [-0.62, 4.5, 0.2], rot: [0, 0, 0.5], color: 0xf0e8d0 }), cone(0.22, 1.3, 6, { at: [0.62, 4.5, 0.2], rot: [0, 0, -0.5], color: 0xf0e8d0 }), box(1.9, 0.18, 1.5, { at: [0, 2.7, 0], color: 0x8a8a90 }))
          .glow(box(0.24, 0.16, 0.1, { at: [-0.26, 4.1, 0.87], color: 0xff2020 }), box(0.24, 0.16, 0.1, { at: [0.26, 4.1, 0.87], color: 0xff2020 }));
        g.add(K.into(new THREE.Group(), 1.6));
        addLimbs([leg('legL', -0.6, 1.4, 1.4, 0.38, 0x3a2a20), leg('legR', 0.6, 1.4, 1.4, 0.38, 0x3a2a20)],
          [arm('armL', -1.4, 3.1, 1.9, 0.3, 0x5a3a2a), arm('armR', 1.4, 3.1, 1.9, 0.3, 0x5a3a2a, k => k.body(cyl(0.12, 0.12, 2.6, 6, { at: [0, -1.9, 0.4], color: 0x6a4a2a })).metal(box(0.25, 1.3, 1.3, { at: [0, 0.2, 0.4], color: 0x9aa0a8, tint: 0.05 })))]);
        break; }
    }
  } else {
    const hull = 0x8896a6, dk = 0x2b3447;
    switch (type) {
      case 'grunt': { const K = new Kit();
        K.metal(box(0.8, 0.95, 0.55, { at: [0, 0.8, 0], color: hull, tint: 0.05, ao: [0.8, 1.8, 0.75] }), box(0.5, 0.42, 0.5, { at: [0, 1.8, 0], color: dk }), box(0.3, 0.3, 0.3, { at: [-0.55, 1.5, 0], color: dk }), box(0.3, 0.3, 0.3, { at: [0.55, 1.5, 0], color: dk }), box(0.5, 0.2, 0.4, { at: [0, 0.65, -0.35], color: IRON }))
          .glow(box(0.4, 0.1, 0.06, { at: [0, 1.95, 0.26], color: 0xff3030 }), box(0.3, 0.1, 0.04, { at: [0, 1.2, 0.29], color: 0xff6a4a }));
        g.add(K.into(new THREE.Group(), 1.6));
        addLimbs([leg('legL', -0.2, 0.8, 0.8, 0.13, dk), leg('legR', 0.2, 0.8, 0.8, 0.13, dk)], [arm('armL', -0.55, 1.6, 0.7, 0.1, dk), arm('armR', 0.55, 1.6, 0.7, 0.1, dk, k => k.metal(box(0.12, 0.14, 0.9, { at: [0, -0.6, 0.35], color: 0x4a5668 })).glow(box(0.07, 0.07, 0.1, { at: [0, -0.6, 0.86], color: 0xff3030 })))]);
        break; }
      case 'runner': { const K = new Kit();
        K.metal(piece(new THREE.ConeGeometry(0.4, 2.0, 5).rotateX(Math.PI / 2), { at: [0, 0.85, 0], color: 0x3a8fb0, tint: 0.06 }), box(0.9, 0.06, 0.5, { at: [0, 0.8, -0.3], color: 0x2a6a88 }), box(0.06, 0.3, 0.5, { at: [0, 1.05, -0.5], color: 0x2a6a88 }))
          .glow(box(0.1, 0.1, 1.4, { at: [0, 1.05, 0.1], color: 0x4de3ff }), cone(0.22, 0.6, 6, { at: [0, 0.85, -1.2], rot: [-Math.PI / 2, 0, 0], color: 0x9ff4ff, ao: [0, 0.6, 0.5] }));
        g.add(K.into(new THREE.Group(), 1.5));
        break; }
      case 'brute': { const K = new Kit();
        K.metal(box(1.5, 0.8, 2.0, { at: [0, 0.85, 0], color: 0x5a6a7a, tint: 0.05, ao: [0.8, 1.7, 0.75] }), cyl(0.7, 0.6, 0.5, 8, { at: [0, 1.65, -0.1], color: dk }), box(0.2, 0.2, 1.5, { at: [0, 1.85, 1.0], color: dk }), box(0.4, 0.7, 2.3, { at: [-0.95, 0.4, 0], color: dk }), box(0.4, 0.7, 2.3, { at: [0.95, 0.4, 0], color: dk }), box(1.2, 0.3, 0.6, { at: [0, 1.65, -0.9], color: IRON }))
          .glow(box(0.6, 0.1, 0.1, { at: [0, 1.95, 0.45], color: 0xff8030 }), box(0.06, 0.3, 1.2, { at: [-0.77, 0.9, 0], color: 0xff8030 }), box(0.06, 0.3, 1.2, { at: [0.77, 0.9, 0], color: 0xff8030 }));
        g.add(K.into(new THREE.Group(), 1.5));
        break; }
      case 'swarm': { const K = new Kit();
        K.glow(oct(0.34, { at: [0, 1.1, 0], color: 0xffa050 })).metal(box(0.3, 0.2, 0.3, { at: [0, 0.75, 0], color: dk }));
        g.add(K.into(new THREE.Group(), 1.4));
        const R = new Kit(); R.metal(box(0.9, 0.04, 0.12, { color: 0x44485a }), box(0.12, 0.04, 0.9, { color: 0x44485a })); g.add(part(R, 'rotor', [0, 1.45, 0]));
        break; }
      case 'boss': { const K = new Kit();
        K.metal(box(2.6, 1.9, 1.8, { at: [0, 2.7, 0], color: 0x4a5a6a, tint: 0.05, ao: [2.7, 4.6, 0.75] }), box(1.0, 1.0, 1.0, { at: [0, 4.6, 0.2], color: dk }), box(0.55, 2.0, 0.55, { at: [-1.9, 3.2, 0.4], color: dk }), box(0.55, 2.0, 0.55, { at: [1.9, 3.2, 0.4], color: dk }), box(0.5, 0.5, 2.0, { at: [-1.9, 3.6, 1.2], color: IRON }), box(0.5, 0.5, 2.0, { at: [1.9, 3.6, 1.2], color: IRON }))
          .glow(sph(0.7, { at: [0, 3.4, 0.9], color: 0xff7aea }), box(0.6, 0.12, 0.1, { at: [0, 4.7, 0.72], color: 0xff3030 }), box(0.1, 1.4, 0.1, { at: [-1.1, 2.9, 0.92], color: 0x4de3ff }), box(0.1, 1.4, 0.1, { at: [1.1, 2.9, 0.92], color: 0x4de3ff }));
        g.add(K.into(new THREE.Group(), 1.5));
        addLimbs([leg('legL', -0.85, 1.9, 1.9, 0.42, dk), leg('legR', 0.85, 1.9, 1.9, 0.42, dk)], []);
        break; }
    }
  }
  return g;
}

// Swing a walker's limbs / spin its rotor. `speed` is its current movement (0 when stunned), `phase` is per-enemy.
export function collectLimbs(mesh) {
  const L = { legs: [], arms: [], rotor: null };
  mesh.traverse(o => { if (o.name === 'legL' || o.name === 'legR') L.legs.push(o); else if (o.name === 'armL' || o.name === 'armR') L.arms.push(o); else if (o.name === 'rotor') L.rotor = o; });
  return L;
}
export function animateEnemy(L, t, speed, phase, stride) {
  if (!L) return;
  const w = t * (3.2 + speed * 1.7) + phase, a = speed > 0.05 ? Math.sin(w) * stride : Math.sin(t * 2 + phase) * 0.04;
  L.legs.forEach((l, i) => { l.rotation.x = (l.name === 'legL' ? 1 : -1) * a * (1 + (i > 1 ? Math.sin(i) * 0.3 : 0)); });
  L.arms.forEach(m => { m.rotation.x = (m.name === 'armL' ? -1 : 1) * a * 0.8; });
  if (L.rotor) L.rotor.rotation.y = t * 30;
}
