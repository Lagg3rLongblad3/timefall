// Debris: two instanced pools of flying pieces. Rubble (stone chunks, clay, bronze) for the ancient era's crumbling deaths and
// neon shards for the futuristic era's shattering ones. Simulated on the CPU (a few hundred pieces at most); one draw call each.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const rnd = Math.random;

class Pool {
  constructor(scene, geo, mat, N, { bounce, settle, glow }) {
    this.N = N; this.head = 0; this.live = 0; this.bounce = bounce; this.settle = settle; this.glow = glow;
    this.mesh = new THREE.InstancedMesh(geo, mat, N); this.mesh.frustumCulled = false; this.mesh.count = N; this.mesh.userData.noShadow = true;
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.rot = new Float32Array(N * 3); this.spin = new Float32Array(N * 3);
    this.sc = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.ground = new Float32Array(N);
    _m.makeScale(0, 0, 0); for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, sx, sy, sz, color, life, ground, hdr = 1) {
    const i = this.head; this.head = (i + 1) % this.N;
    if (this.life[i] <= 0) this.live++;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z; this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.rot[k] = rnd() * 6.28; this.rot[k + 1] = rnd() * 6.28; this.rot[k + 2] = rnd() * 6.28;
    this.spin[k] = (rnd() - 0.5) * 16; this.spin[k + 1] = (rnd() - 0.5) * 16; this.spin[k + 2] = (rnd() - 0.5) * 16;
    this.sc[k] = sx; this.sc[k + 1] = sy; this.sc[k + 2] = sz; this.life[i] = this.max[i] = life; this.ground[i] = ground;
    _c.setHex(color); if (hdr !== 1) _c.multiplyScalar(hdr); this.mesh.setColorAt(i, _c); this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    if (this.live <= 0) return;
    const { pos, vel, rot, spin, sc, life, max, ground } = this;
    for (let i = 0; i < this.N; i++) {
      if (life[i] <= 0) continue;
      const k = i * 3;
      life[i] -= dt;
      if (life[i] <= 0) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); this.live--; continue; }
      vel[k + 1] -= 24 * dt;
      pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
      const floor = ground[i] + sc[k + 1] * 0.5;
      if (pos[k + 1] < floor) { // landed: bounce a little, scrub speed and spin (per-second factors, so it looks the same at any frame rate)
        const fr = Math.pow(this.settle, dt * 12), fs = Math.pow(0.5, dt * 12);
        pos[k + 1] = floor; vel[k + 1] = Math.abs(vel[k + 1]) * this.bounce;
        vel[k] *= fr; vel[k + 2] *= fr; spin[k] *= fs; spin[k + 1] *= fs; spin[k + 2] *= fs;
        if (vel[k + 1] < 1.2) vel[k + 1] = 0;
      }
      rot[k] += spin[k] * dt; rot[k + 1] += spin[k + 1] * dt; rot[k + 2] += spin[k + 2] * dt;
      const t = life[i] / max[i], f = this.glow ? Math.min(1, t * 3) * (0.6 + 0.4 * Math.sin(life[i] * 40 + i)) : Math.min(1, t * 2.5);
      _m.compose(_p.set(pos[k], pos[k + 1], pos[k + 2]), _q.setFromEuler(_e.set(rot[k], rot[k + 1], rot[k + 2])), _s.set(sc[k] * f, sc[k + 1] * f, sc[k + 2] * f));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
}

const RUBBLE = [0x8a8274, 0x6f675a, 0xa39a86, 0x5e564a, 0xb08850, 0x7a5a3a]; // stone, dark stone, sandstone, shadow, bronze, clay

export class Debris {
  constructor(scene) {
    this.scene = scene;
    const chunk = new THREE.IcosahedronGeometry(0.5, 0); // flat-shaded, slightly irregular
    const p = chunk.attributes.position; for (let i = 0; i < p.count; i++) { const h = Math.sin(i * 12.9898) * 43758.5453; p.setXYZ(i, p.getX(i) * (0.85 + (h - Math.floor(h)) * 0.3), p.getY(i), p.getZ(i)); }
    chunk.computeVertexNormals();
    this.rubble = new Pool(scene, chunk, new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true }), 150, { bounce: 0.32, settle: 0.55, glow: false });
    const shard = new THREE.TetrahedronGeometry(0.5, 0);
    this.shards = new Pool(scene, shard, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), 170, { bounce: 0.55, settle: 0.7, glow: true });
  }
  // stone chunks, thrown outwards from (x,y,z) -- y is the middle of the body, ground the floor they land on
  crumble(x, y, z, size, n, ground) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, sp = (2.2 + rnd() * 3.4) * (0.7 + size * 0.3), s = (0.1 + rnd() * 0.2) * (0.55 + size * 0.55);
      this.rubble.emit(x + Math.cos(a) * size * 0.25, y + (rnd() - 0.3) * size * 0.9, z + Math.sin(a) * size * 0.25, Math.cos(a) * sp, 2.5 + rnd() * 4, Math.sin(a) * sp, s * (0.8 + rnd() * 0.6), s * (0.6 + rnd() * 0.6), s * (0.8 + rnd() * 0.6), RUBBLE[(rnd() * RUBBLE.length) | 0], 1.6 + rnd() * 1.4, ground);
    }
  }
  // neon slivers
  shatter(x, y, z, size, n, ground) {
    const cols = [0x4de3ff, 0xff4de1, 0xaaf4ff, 0x4de3ff];
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, e = (rnd() - 0.3) * 1.6, sp = (3 + rnd() * 6) * (0.7 + size * 0.3), s = (0.12 + rnd() * 0.22) * (0.6 + size * 0.5);
      this.shards.emit(x + (rnd() - 0.5) * size * 0.5, y + (rnd() - 0.3) * size * 0.9, z + (rnd() - 0.5) * size * 0.5, Math.cos(a) * sp, e * sp * 0.6 + 2.5, Math.sin(a) * sp, s, s * 0.22, s * 1.7, cols[(rnd() * cols.length) | 0], 0.7 + rnd() * 0.7, ground, 2.6);
    }
  }
  update(dt) { this.rubble.update(dt); this.shards.update(dt); }
  dispose() { this.rubble.dispose(this.scene); this.shards.dispose(this.scene); }
}
