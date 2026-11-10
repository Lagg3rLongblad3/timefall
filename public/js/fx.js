// Effects: GPU point particles, pooled additive beams / lightning, expanding rings & flashes, floating text.
import * as THREE from 'three';
import { Debris } from './debris.js';
import { Decals, MARK } from './decals.js';

const VERT = /* glsl */`
uniform float uScale;
attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
varying vec3 vColor; varying float vAlpha;
void main() {
  vColor = aColor; vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(aSize * uScale / max(0.1, -mv.z), 0.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
varying vec3 vColor; varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.0, 0.25, dot(c, c))) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * 1.5, a);
  #include <colorspace_fragment>
}`;

const _c = new THREE.Color();
const rnd = () => Math.random();

// Free GPU buffers of everything under root (three.js never does this when a mesh is merely removed from a scene).
export function disposeTree(root) {
  root.traverse(o => {
    if (o.userData?.onDispose) o.userData.onDispose();
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (m) for (const mm of Array.isArray(m) ? m : [m]) { if (mm.map) mm.map.dispose(); mm.dispose(); }
  });
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    const N = (this.N = 2200);
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.col = new Float32Array(N * 3);
    this.alpha = new Float32Array(N); this.size = new Float32Array(N);
    this.life = new Float32Array(N); this.max = new Float32Array(N); this.base = new Float32Array(N);
    this.grav = new Float32Array(N); this.drag = new Float32Array(N);
    this.head = 0; this.live = 0;
    this.geo = new THREE.BufferGeometry();
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aColor', dyn(this.col, 3));
    this.geo.setAttribute('aAlpha', dyn(this.alpha, 1));
    this.geo.setAttribute('aSize', dyn(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);

    this.beamGeo = new THREE.BoxGeometry(1, 1, 1);
    this.beamMats = new Map(); this.beams = []; this.beamFree = [];
    this.ringGeos = new Map(); this.rings = []; this.flashes = []; this.texts = [];
    this.flashGeo = new THREE.SphereGeometry(1, 20, 14);
    this.texCache = new Map();
    // ground marks (need the terrain: see setWorld) and flying debris; the Node-side bot simulations never draw, so they get neither
    this.time = 0; this.dec = null; this.deb = typeof document !== 'undefined' ? new Debris(scene) : null;
    // soft radial glow for flashes (a canvas gradient; Node-side simulations have no canvas and use a plain sphere)
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(0.6, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); this.glowTex = new THREE.CanvasTexture(cv); this.glowTex.colorSpace = THREE.SRGBColorSpace;
    }
  }

  // the world is built before the FX, so the game hands it over: marks on the ground follow its terrain
  setWorld(world, fut) { if (typeof document !== 'undefined' && !this.dec) this.dec = new Decals(this.scene, { heightAt: world.heightAt, theme: world.map.theme, sunDir: world.look.sunDir, fut }); }
  // kind: fire | crater | bolt | pit | blast | burn
  scorch(kind, x, z, r, strength = 1) { this.dec?.add(MARK[kind], x, z, r, strength); }
  crumble(x, y, z, size, n, ground) { this.deb?.crumble(x, y, z, size, n, ground); }   // stone chunks (ancient deaths)
  shatter(x, y, z, size, n, ground) { this.deb?.shatter(x, y, z, size, n, ground); }   // neon shards (futuristic deaths)

  // pixels-per-world-unit scale for point sprites (drawing-buffer height and vertical fov in degrees)
  setView(heightPx, fovDeg) { this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360)); }

  // ---------- particles ----------
  emit(x, y, z, vx, vy, vz, color, life, size, grav = 0, drag = 0) {
    const i = this.head; this.head = (i + 1) % this.N;
    if (this.life[i] <= 0) this.live++;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    _c.setHex(color); // sRGB hex -> linear; the shader below encodes it again for whichever target it draws into
    this.col[k] = _c.r; this.col[k + 1] = _c.g; this.col[k + 2] = _c.b;
    this.life[i] = this.max[i] = life; this.base[i] = size; this.grav[i] = grav; this.drag[i] = drag;
    this.alpha[i] = 1; this.size[i] = size;
  }
  burst(x, y, z, color, n = 10, speed = 5, life = 0.6, size = 0.5, grav = 8, up = 1.5) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.2832, e = rnd() * 2 - 1, r = Math.sqrt(1 - e * e), s = speed * (0.35 + rnd() * 0.65);
      this.emit(x, y, z, Math.cos(a) * r * s, e * s * 0.8 + up, Math.sin(a) * r * s, color, life * (0.6 + rnd() * 0.5), size * (0.6 + rnd() * 0.8), grav, 1.2);
    }
  }
  // particles that stream from a point towards a target (resource pickup feel)
  stream(from, to, color, n = 5, life = 0.45) {
    for (let i = 0; i < n; i++) {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, t = life * (0.8 + rnd() * 0.4);
      this.emit(from.x + (rnd() - 0.5) * 0.8, from.y + rnd() * 0.8, from.z + (rnd() - 0.5) * 0.8, dx / t + (rnd() - 0.5) * 2, dy / t + (rnd() - 0.5) * 2, dz / t + (rnd() - 0.5) * 2, color, t, 0.35, 0, 0);
    }
  }
  // particles falling inward onto (x,y,z) from a ring of the given radius (gravity well)
  inflow(x, y, z, radius, color, n = 2) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.2832, r = radius * (0.5 + rnd() * 0.5), t = 0.7;
      this.emit(x + Math.cos(a) * r, y + 0.4 + rnd() * 2.5, z + Math.sin(a) * r, -Math.cos(a) * r / t, 0, -Math.sin(a) * r / t, color, t, 0.4, 0, 0);
    }
  }

  // ---------- beams ----------
  beamMat(color, opacity) {
    const key = color + '|' + opacity;
    let m = this.beamMats.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); m.color.multiplyScalar(1.7); this.beamMats.set(key, m); }
    return m;
  }
  beam(a, b, color = 0xffffff, width = 0.15, life = 0.12, opacity = 1) {
    if (this.beams.length > 380) return;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;
    const mesh = this.beamFree.pop() || new THREE.Mesh(this.beamGeo, null);
    mesh.material = this.beamMat(color, opacity);
    mesh.position.set(a.x + dx / 2, a.y + dy / 2, a.z + dz / 2);
    mesh.lookAt(b.x, b.y, b.z);
    mesh.scale.set(width, width, len);
    mesh.visible = true; mesh.renderOrder = 4;
    if (!mesh.parent) this.scene.add(mesh);
    this.beams.push({ mesh, life, max: life, w: width });
  }
  bolt(a, b, color = 0xbfe9ff, width = 0.18, life = 0.16, jag = 0.9) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;
    const n = Math.max(2, Math.min(10, Math.ceil(len / 2.4)));
    let px = -dz, pz = dx; const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
    let prev = a;
    for (let i = 1; i <= n; i++) {
      let q = b;
      if (i < n) {
        const t = i / n, amp = jag * Math.sin(Math.PI * t) * (0.5 + rnd() * 0.7), o1 = (rnd() * 2 - 1) * amp, o2 = (rnd() * 2 - 1) * amp;
        q = { x: a.x + dx * t + px * o1, y: a.y + dy * t + o2, z: a.z + dz * t + pz * o1 };
      }
      this.beam(prev, q, color, width, life, 1);
      this.beam(prev, q, color, width * 2.8, life, 0.26);
      prev = q;
    }
  }

  // ---------- rings, flashes ----------
  ring(x, y, z, color, radius, life = 0.6, thick = 0.2) {
    let geo = this.ringGeos.get(thick);
    if (!geo) { geo = new THREE.RingGeometry(1 - thick, 1, 56).rotateX(-Math.PI / 2); this.ringGeos.set(thick, geo); }
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }); mat.color.multiplyScalar(1.7);
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y + 0.5, z); mesh.scale.setScalar(0.1); mesh.renderOrder = 3;
    this.scene.add(mesh); this.rings.push({ mesh, mat, life, max: life, radius });
  }
  flash(x, y, z, color, radius, life = 0.35, opacity = 0.7) {
    const soft = !!this.glowTex, mat = soft ? new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }) : new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    mat.color.multiplyScalar(soft ? 2.4 : 1.7);
    const mesh = soft ? new THREE.Sprite(mat) : new THREE.Mesh(this.flashGeo, mat); mesh.position.set(x, y, z); mesh.scale.setScalar((soft ? 2.2 : 0.2) * radius); mesh.renderOrder = 3; mesh.userData.soft = soft;
    this.scene.add(mesh); this.flashes.push({ mesh, mat, life, max: life, radius, opacity });
  }

  // ---------- floating text ----------
  textTex(str, color) {
    const key = str + '|' + color;
    let t = this.texCache.get(key);
    if (t) return t;
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    ctx.font = 'bold 40px system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(str).width) + 20, h = 60;
    cv.width = w; cv.height = h;
    ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round'; ctx.strokeText(str, w / 2, h / 2 + 2);
    ctx.fillStyle = color; ctx.fillText(str, w / 2, h / 2 + 2);
    const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
    t = { map, aspect: w / h }; this.texCache.set(key, t);
    return t;
  }
  text(x, y, z, str, color = '#ffffff', scale = 1) {
    const t = this.textTex(str, color);
    if (!t) return;
    const mat = new THREE.SpriteMaterial({ map: t.map, transparent: true, depthTest: false, depthWrite: false, fog: false }); mat.color.setScalar(1.5); // >1: survives the tone-mapper as bright text
    const sp = new THREE.Sprite(mat); sp.scale.set(t.aspect * scale, scale, 1); sp.position.set(x, y, z); sp.renderOrder = 10;
    this.scene.add(sp); this.texts.push({ sp, mat, life: 1.25, max: 1.25, y });
  }

  update(dt) {
    this.time += dt; this.dec?.update(this.time); this.deb?.update(dt);
    // particles
    if (this.live > 0) {
      const { pos, vel, life, max, base, grav, drag, alpha, size } = this;
      for (let i = 0; i < this.N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { alpha[i] = 0; size[i] = 0; this.live--; continue; }
        const k = i * 3, t = life[i] / max[i];
        vel[k + 1] -= grav[i] * dt;
        const dr = 1 - Math.min(1, drag[i] * dt);
        vel[k] *= dr; vel[k + 1] *= dr; vel[k + 2] *= dr;
        pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
        alpha[i] = Math.min(1, t * 2.2); size[i] = base[i] * (0.5 + 0.5 * t);
      }
      const at = this.geo.attributes;
      at.position.needsUpdate = at.aAlpha.needsUpdate = at.aSize.needsUpdate = at.aColor.needsUpdate = true;
    }
    // beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]; b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; this.beamFree.push(b.mesh); this.beams.splice(i, 1); continue; }
      b.mesh.scale.x = b.mesh.scale.y = b.w * (0.2 + 0.8 * (b.life / b.max));
    }
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.life -= dt;
      if (r.life <= 0) { this.scene.remove(r.mesh); r.mat.dispose(); this.rings.splice(i, 1); continue; }
      const t = 1 - r.life / r.max, e = 1 - (1 - t) * (1 - t);
      r.mesh.scale.setScalar(Math.max(0.1, r.radius * e)); r.mat.opacity = 0.9 * (1 - t);
    }
    // flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.life -= dt;
      if (f.life <= 0) { this.scene.remove(f.mesh); f.mat.dispose(); this.flashes.splice(i, 1); continue; }
      const t = 1 - f.life / f.max;
      f.mesh.scale.setScalar(f.radius * (f.mesh.userData.soft ? 2.2 : 1) * (0.2 + 0.8 * Math.sqrt(t))); f.mat.opacity = f.opacity * (1 - t) * (1 - t);
    }
    // floating text
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.life -= dt;
      if (t.life <= 0) { this.scene.remove(t.sp); t.mat.dispose(); this.texts.splice(i, 1); continue; }
      const k = 1 - t.life / t.max;
      t.sp.position.y = t.y + k * 2.4; t.mat.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }

  dispose() {
    for (const r of this.rings) { this.scene.remove(r.mesh); r.mat.dispose(); }
    for (const f of this.flashes) { this.scene.remove(f.mesh); f.mat.dispose(); }
    for (const t of this.texts) { this.scene.remove(t.sp); t.mat.dispose(); }
    for (const b of [...this.beams, ...this.beamFree.map(m => ({ mesh: m }))]) this.scene.remove(b.mesh);
    this.scene.remove(this.points); this.dec?.dispose(); this.deb?.dispose();
    this.geo.dispose(); this.mat.dispose(); this.beamGeo.dispose(); this.flashGeo.dispose(); this.glowTex?.dispose();
    for (const m of this.beamMats.values()) m.dispose();
    for (const g of this.ringGeos.values()) g.dispose();
    for (const t of this.texCache.values()) t.map.dispose();
    this.rings.length = this.flashes.length = this.texts.length = this.beams.length = this.beamFree.length = 0;
  }
}
