// TIMEFALL gameplay: first-person exploration, gathering, building, waves, combat and duel logic.
// No DOM work happens here except input listeners; the HUD (hud.js) reads this object's state every frame.
import * as THREE from 'three';
import { buildWorld, HALF } from './world.js';
import { towerModel, enemyModel, collectLimbs, animateEnemy } from './models.js';
import { FX, disposeTree } from './fx.js';
import { shade } from './gfx.js';
import { StatusKit, EnemyStatus } from './status.js';
import { AI, statsFor, initTower, animate as animateTower } from './towers.js';
import { planWave, hpMul, speedMul, isBossWave, waveSummary } from './waves.js';
import { SWING, swingPose } from './swing.js';
import { RES, TOWERS, ENEMIES, DIFFS, getMap, WAVE_TIMING, PVP, NODE_RESPAWN, MAX_LEVEL, SENDS, SEND_COOLDOWN, startRes } from './data.js';

const STRIDE = { grunt: 0.7, runner: 1.0, brute: 0.5, swarm: 0.7, boss: 0.4 };   // leg swing (radians) while walking
const BASE_FOV = 74, EYE = 1.7, WALK = 8, SPRINT = 12.5, JUMP = 9.2, GRAVITY = 26, MAX_SLOPE = 1.9, SENS = 0.0022;
const REACH = 5.6;                          // gathering reach (the chop rhythm lives in swing.js)
const ZERO_POSE = [0, 0, 0, 0, 0, 0];
const BUILD_RANGE = 40, TOWER_GAP = 4.8;    // building
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = Math.random;
const QUIET = { burn: 1, frost: 1, grav: 1 };   // damage that ticks all the time does not flash the enemy (its own status look shows it instead)
const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), V0 = new THREE.Vector3();

export class Game {
  constructor(o) {
    this.o = o; this.ui = o.ui || {}; this.music = o.music; this.net = o.net;
    this.mode = o.mode; this.pvp = o.mode === 'pvp'; this.era = o.era;
    this.diff = this.pvp ? PVP.diff : o.diff;
    this.cfg = this.pvp ? PVP : DIFFS[this.diff];
    this.hpCfg = DIFFS[this.diff];
    this.timing = this.pvp ? PVP : WAVE_TIMING[this.diff];
    this.map = getMap(this.era, this.diff, o.mapIdx);
    this.seed = this.pvp ? o.seed : this.map.seed;
    this.world = buildWorld(this.map);
    this.scene = this.world.scene;
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, o.aspect || 16 / 9, 0.1, 1200);
    this.scene.add(this.camera);
    this.fx = new FX(this.scene);
    this.vis = typeof document !== 'undefined'; // the Node bot simulations never draw: they skip the render-only extras (status looks, debris, ground marks)
    this.fx.setWorld(this.world, this.era === 'futuristic');
    this.skit = this.vis ? new StatusKit(this.era, this.fx.mat.uniforms.uScale) : null; this.dying = [];
    this.resList = RES[this.era]; this.defs = TOWERS[this.era];
    this.res = startRes(this.era, this.cfg);

    this.t = 0; this.state = 'playing'; this.paused = false;
    this.baseMax = this.cfg.base; this.baseHp = this.baseMax;
    this.wave = 0; this.waveTotal = this.pvp ? Infinity : this.cfg.waves; this.nextWaveIn = this.timing.prep;
    this.queue = []; this.enemies = []; this.towers = []; this.proj = []; this.dirty = false; this.eid = 0;
    this.stats = { kills: 0, leaks: 0, built: 0, gathered: 0, time: 0 };
    this.shakeAmt = 0; this.lastSfx = {}; this.hitFlash = 0;

    // player: x/z/y are at the feet
    const w = this.world, sp = w.pointAt(Math.max(0, w.pathLen - 15)), la = w.pointAt(Math.max(0, w.pathLen - 45));
    this.player = { x: sp.x, y: w.heightAt(sp.x, sp.z), z: sp.z, vx: 0, vy: 0, vz: 0, yaw: Math.atan2(-(la.x - sp.x), -(la.z - sp.z)), pitch: -0.12, onGround: true, hitCd: 0, swingT: -1, hitDone: true, swingHit: false, swingTarget: null, whoosh: true, bob: 0, sprinting: false };
    this.fwd = new THREE.Vector3(); this.k = {}; this.mouse = { l: false, r: false, lEdge: false }; this.look = { dx: 0, dy: 0 };
    this.aim = null; this.buildIdx = -1; this.ghost = null; this.ghostInfo = { ok: false, reason: '', afford: false, x: 0, z: 0 };
    this.sellArm = null; this.sendCd = 0; this.stTimer = 1; this.discoverT = 0;
    this.opp = this.pvp ? { name: o.opponent || 'Rival', hp: PVP.base, max: PVP.base, wave: 0, towers: 0, kills: 0 } : null;
    this.tpl = {};   // enemy model templates (clones share geometry + materials)

    for (const n of w.nodes) { n.seen = false; n.shake = 0; n.grow = 1; }
    this.punchS = { x: 0, vx: 0, z: 0, vz: 0 };   // camera kick springs (pitch dip + roll) when a chop lands
    this.fp = { move: 0, sprint: 0, calm: 1, sx: 0, sy: 0, v: { move: 0, sprint: 0, calm: 0, sx: 0, sy: 0 }, lastYaw: this.player.yaw, lastPitch: this.player.pitch, prevT: -1, flash: 0 };
    this.swPose = [0, 0, 0, 0, 0, 0];
    this.mkShared(); this.buildTool(); this.buildTrail();
    this.attachInput();
    this.resize(o.width || 1280, o.height || 720, o.dpr || 1);
    this.updateCamera(0);
  }

  get locked() { return !!this.o.alwaysActive || (this.dom.document && this.dom.document.pointerLockElement === this.o.canvas); }

  // ------------------------------------------------------------------ setup helpers
  mkShared() {
    const g = this.pg = {
      boulder: new THREE.SphereGeometry(0.85, 10, 8), fire: new THREE.SphereGeometry(0.5, 8, 6),
      shaft: new THREE.BoxGeometry(0.12, 0.12, 2.6), head: new THREE.ConeGeometry(0.22, 0.7, 6).rotateX(Math.PI / 2).translate(0, 0, 1.6),
      plane: new THREE.PlaneGeometry(1, 1), planeL: new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0),
      pip: new THREE.OctahedronGeometry(0.28),
    };
    const bm = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
    this.pm = {
      boulder: new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.9, flatShading: true }), fire: bm(0xffb030), bolt: new THREE.MeshStandardMaterial({ color: 0x9b6a3a, roughness: 0.7 }), boltHead: new THREE.MeshStandardMaterial({ color: 0xaab0b8, roughness: 0.35, metalness: 0.7 }),
      barBg: bm(0x000000, { transparent: true, opacity: 0.6 }), barG: bm(0x58e07a), barY: bm(0xf2d34d), barR: bm(0xff5555),
      pip: bm(0xffd84d), ghost: new THREE.MeshStandardMaterial({ color: 0x66ff99, emissive: 0x114422, roughness: 0.6, transparent: true, opacity: 0.62, depthWrite: false }),
    };
    // range rings: a glowing ribbon hugging the ground (97 samples x inner/outer edge)
    const ring = c => { const N = 96, idx = [], geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
      for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      m.material.color.multiplyScalar(1.5); m.renderOrder = 6; m.visible = false; m.frustumCulled = false; this.scene.add(m); return m; };
    this.ringMain = ring(0xffffff); this.ringMin = ring(0xff8888); this.ringAim = ring(0xffe9a0);
  }

  buildTool() {
    const fut = this.era === 'futuristic', g = new THREE.Group();
    const m = (c, e = 0x000000) => new THREE.MeshStandardMaterial({ color: c, emissive: e, roughness: fut ? 0.45 : 0.85, metalness: e || !fut ? 0 : 0.5 }); // a stone axe is not metal: it should not mirror the cool sky
    const b = (w, h, d, mat, x, y, z) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); return mesh; };
    // Both tools are modelled with the HAND at the origin, so a swing pivots around the grip like a real arm would.
    if (!fut) { // stone axe
      g.add(b(0.06, 0.62, 0.06, m(0x8a5a2a), 0, 0.25, 0), b(0.28, 0.16, 0.07, m(0x948c80), -0.11, 0.53, 0), b(0.04, 0.22, 0.08, m(0xd8d2c6), -0.26, 0.53, 0)); // edge faces the centre of the screen, so it leads a right-to-left chop
      g.rotation.set(-0.2, 0, -0.28); g.position.set(0.315, -0.465, -0.63);
      this.bladeA = [-0.28, 0.61, 0]; this.bladeB = [-0.28, 0.46, 0];   // the middle of the cutting edge: the two ends of the swoosh trail
    } else { // plasma cutter
      this.toolTip = b(0.05, 0.05, 0.15, m(0x4de3ff, 0x4de3ff), 0, 0.08, -0.38);
      g.add(b(0.09, 0.09, 0.44, m(0x39465e), 0, 0.08, -0.10), this.toolTip, b(0.06, 0.17, 0.07, m(0x252d3d), 0, -0.04, 0), b(0.03, 0.03, 0.2, m(0x6dff8f, 0x6dff8f), 0, 0.14, -0.10));
      g.rotation.set(0.05, 0.08, 0); g.position.set(0.36, -0.376, -0.578);
      this.bladeA = [0, 0.08, -0.47]; this.bladeB = [0, 0.08, -0.27];
    }
    g.scale.setScalar(0.82);
    this.tool = g; this.toolBase = { pos: g.position.clone(), rot: g.rotation.clone() }; this.camera.add(g);
  }

  // A fading ribbon between the two ends of the blade's cutting edge, sampled along the strike (camera space).
  buildTrail() {
    const N = 30, idx = [], fut = this.era === 'futuristic';
    for (let i = 0; i < N - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 6), col = new Float32Array(N * 8);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx); geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    mesh.frustumCulled = false; mesh.renderOrder = 20; mesh.visible = false; this.camera.add(mesh);
    this.trail = { N, pos, col, geo, mesh, samples: [], ghost: new THREE.Object3D(), A: new THREE.Vector3(), B: new THREE.Vector3(), pose: [0, 0, 0, 0, 0, 0], color: new THREE.Color(fut ? 0x66ecff : 0xfff4dc), alpha: fut ? 0.7 : 0.4 };
  }

  attachInput() {
    const win = this.o.window ?? globalThis.window, doc = this.o.document ?? globalThis.document;
    this.dom = { window: win, document: doc }; this.h = [];
    if (!win || !doc) return;
    const on = (t, ev, fn) => { t.addEventListener(ev, fn); this.h.push([t, ev, fn]); };
    on(win, 'keydown', e => this.keyDown(e));
    on(win, 'keyup', e => { this.k[e.code] = false; });
    on(doc, 'mousemove', e => { if (this.locked) { this.look.dx += e.movementX || 0; this.look.dy += e.movementY || 0; } });
    on(doc, 'mousedown', e => { if (!this.locked) return; if (e.button === 0) { this.mouse.l = true; this.mouse.lEdge = true; } if (e.button === 2) { this.mouse.r = true; this.cancelBuild(); } });
    on(doc, 'mouseup', e => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    on(doc, 'contextmenu', e => { if (this.locked) e.preventDefault(); });
    on(win, 'blur', () => { this.k = {}; this.mouse.l = this.mouse.r = false; });
  }

  keyDown(e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) return;
    if (!this.locked) return;
    this.k[e.code] = true;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault?.();
    if (e.repeat || this.state !== 'playing') return;
    const dm = /^Digit([1-6])$/.exec(e.code);
    if (dm) return this.select(+dm[1] - 1);
    switch (e.code) {
      case 'KeyQ': this.cancelBuild(); break;
      case 'KeyF': if (this.aim?.kind === 'tower') this.upgrade(this.aim.ref); break;
      case 'KeyR': if (this.aim?.kind === 'tower') this.sellPress(this.aim.ref); break;
      case 'KeyN': this.callWave(); break;
      case 'KeyZ': this.sendEnemies(0); break;
      case 'KeyX': this.sendEnemies(1); break;
      case 'KeyC': this.sendEnemies(2); break;
      case 'KeyV': this.sendEnemies(3); break;
    }
  }

  resize(w, h, dpr = 1) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.fx.setView(h * dpr, this.camera.fov);
  }
  setPaused(p) { if (!this.pvp) this.paused = p; }

  // ------------------------------------------------------------------ helpers shared with tower AI
  sfx(name, x, z, vol = 1) {
    const m = this.music; if (!m) return;
    const now = performance.now();
    if (now - (this.lastSfx[name] || 0) < 55) return;
    this.lastSfx[name] = now;
    if (x !== undefined) vol *= 1 / (1 + Math.hypot(x - this.player.x, z - this.player.z) / 28);
    m.sfx(name, vol);
  }
  shake(amount, x, z) {
    const d = x === undefined ? 0 : Math.hypot(x - this.player.x, z - this.player.z);
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount * clamp(1 - d / 60, 0, 1));
  }
  toast(m, kind) { this.ui.toast?.(m, kind); }
  feed(m) { this.ui.feed?.(m); }

  near(x, z, r, minR = 0) {
    const out = [], r2 = r * r, m2 = minR * minR;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - x, dz = e.z - z, d2 = dx * dx + dz * dz;
      if (d2 <= r2 && d2 >= m2) { e._dist = Math.sqrt(d2); out.push(e); }
    }
    return out;
  }
  posAt(d, lane = 0) {
    const w = this.world, a = w.pointAt(Math.max(0, d - 1), P0), b = w.pointAt(d + 1, P1);
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, c = w.pointAt(d, P2);
    const x = c.x - dz / l * lane, z = c.z + dx / l * lane;
    return { x, y: w.heightAt(x, z), z };
  }

  // ------------------------------------------------------------------ economy
  canAfford(cost) { for (const k in cost) if ((this.res[k] || 0) < cost[k]) return false; return true; }
  spend(cost) { for (const k in cost) this.res[k] -= cost[k]; }
  missing(cost) { for (const k in cost) if ((this.res[k] || 0) < cost[k]) return this.resList.find(r => r.id === k).name; return null; }
  tierCost(arr) { const c = {}; arr.forEach((n, i) => { if (n) c[this.resList[i].id] = n; }); return c; }

  // ------------------------------------------------------------------ main update
  update(dt) {
    if (this.paused) return;
    this.t += dt;
    if (this.state !== 'playing') { this.updateDying(dt); this.skit?.tick(this.t); this.fx.update(dt); this.updateCamera(dt); this.world.focus(this.camera.position); this.tickSwing(dt, false); this.updateTool(dt); this.world.animate(this.t, this.camera.position); for (const tw of this.towers) animateTower(tw, this.t, dt); return; }
    this.updatePlayer(dt);
    this.updateCamera(dt); // pose first: aiming, gathering and the build ghost must use this frame's view direction
    this.world.focus(this.camera.position);
    this.updateAim();
    this.updateGather(dt);
    this.updateTool(dt);
    this.updateBuild(dt);
    this.updateWaves(dt);
    this.updateEnemies(dt);
    this.updateDying(dt);
    this.skit?.tick(this.t);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateNodes(dt);
    this.updateMisc(dt);
    this.fx.update(dt);
    this.world.animate(this.t, this.camera.position);
    this.checkEnd();
  }

  // ------------------------------------------------------------------ player
  updatePlayer(dt) {
    const p = this.player, k = this.k, w = this.world;
    p.yaw -= this.look.dx * SENS; p.pitch = clamp(p.pitch - this.look.dy * SENS, -1.45, 1.45); this.look.dx = this.look.dy = 0;
    let f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const l = Math.hypot(f, s) || 1; f /= l; s /= l;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    p.sprinting = !!(k.ShiftLeft || k.ShiftRight) && f > 0;
    const speed = p.sprinting ? SPRINT : WALK, a = 1 - Math.exp(-(p.onGround ? 14 : 3) * dt);
    p.vx += ((-sin * f + cos * s) * speed - p.vx) * a; p.vz += ((-cos * f - sin * s) * speed - p.vz) * a;
    this.moveXZ(p, p.vx * dt, p.vz * dt);
    if (k.Space && p.onGround) { p.vy = JUMP; p.onGround = false; }
    const gh = w.heightAt(p.x, p.z), wasGround = p.onGround;
    p.vy -= GRAVITY * dt; p.y += p.vy * dt;
    if (p.y <= gh) { p.y = gh; p.vy = 0; p.onGround = true; }
    else if (wasGround && p.vy <= 0 && p.y - gh < 0.55 && p.vy > -GRAVITY * dt * 2) { p.y = gh; p.vy = 0; p.onGround = true; } // stick to slopes when walking downhill
    else p.onGround = false;
    this.pushOut(p);
  }
  moveXZ(p, dx, dz) {
    const w = this.world, lim = HALF - 4;
    const ok = (nx, nz) => {
      nx = clamp(nx, -lim, lim); nz = clamp(nz, -lim, lim);
      const d = Math.hypot(nx - p.x, nz - p.z);
      if (d < 1e-6) return true;
      if (p.onGround && (w.heightAt(nx, nz) - w.heightAt(p.x, p.z)) / d > MAX_SLOPE) return false; // too steep to walk up
      p.x = nx; p.z = nz; return true;
    };
    if (ok(p.x + dx, p.z + dz)) return;
    if (ok(p.x + dx, p.z)) { p.vz = 0; return; }
    if (ok(p.x, p.z + dz)) { p.vx = 0; return; }
    p.vx = p.vz = 0;
  }
  pushOut(p) { // solid towers, resource nodes and the base building
    const push = (cx, cz, r) => { const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz); if (d < r && d > 1e-4) { p.x = cx + dx / d * r; p.z = cz + dz / d * r; } };
    for (const tw of this.towers) if (p.y < tw.y + 3.5) push(tw.x, tw.z, 2.2);
    for (const n of this.world.nodes) if (n.hits > 0) push(n.x, n.z, n.type === 0 ? 1.0 : 1.5);
    push(this.world.basePos.x, this.world.basePos.z, 4.6);
  }

  updateCamera(dt) {
    const p = this.player, cam = this.camera;
    const sp = Math.hypot(p.vx, p.vz); p.bob += dt * sp;
    const bob = p.onGround ? Math.sin(p.bob * 1.9) * Math.min(1, sp / 8) * 0.06 : 0;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    const sh = this.shakeAmt * 0.4;
    cam.position.set(p.x + (rnd() - 0.5) * sh, p.y + EYE + bob + (rnd() - 0.5) * sh, p.z + (rnd() - 0.5) * sh);
    const pu = this.punchS; // damped springs; the aim direction (this.fwd, below) deliberately ignores the kick
    pu.vx += (-170 * pu.x - 19 * pu.vx) * dt; pu.x += pu.vx * dt;
    pu.vz += (-170 * pu.z - 19 * pu.vz) * dt; pu.z += pu.vz * dt;
    cam.rotation.set(p.pitch + pu.x, p.yaw, pu.z, 'YXZ');
    const fov = BASE_FOV + (p.sprinting && sp > 8 ? 6 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }
    this.fwd.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    this.hitFlash = Math.max(0, this.hitFlash - dt);
  }

  // ------------------------------------------------------------------ what the crosshair points at
  updateAim() {
    this.aim = null;
    if (this.buildIdx >= 0) { this.ringAim.visible = false; return; }
    const c = this.camera.position, f = this.fwd, w = this.world;
    let node = null, nd = 1e9;
    for (const n of w.nodes) {
      if (n.hits <= 0) continue;
      const dx = n.x - c.x, dz = n.z - c.z, dy = w.heightAt(n.x, n.z) + 1.4 - c.y, d = Math.hypot(dx, dz);
      if (d > REACH + 0.8) continue;
      if ((dx * f.x + dy * f.y + dz * f.z) / (Math.hypot(dx, dy, dz) || 1) < 0.5) continue; // roughly in front of you
      if (d < nd) { nd = d; node = n; }
    }
    let tower = null, td = 1e9;
    for (const tw of this.towers) {
      const vx = tw.x - c.x, vy = tw.y + 2 - c.y, vz = tw.z - c.z, proj = vx * f.x + vy * f.y + vz * f.z;
      if (proj < 0.5 || proj > 30) continue;
      if (vx * vx + vy * vy + vz * vz - proj * proj > 2.7 * 2.7) continue;
      if (proj < td) { td = proj; tower = tw; }
    }
    this.aim = tower && (!node || td < nd) ? { kind: 'tower', ref: tower, dist: td } : node ? { kind: 'node', ref: node, dist: nd } : null;
    if (this.aim?.kind === 'tower') { this.setRing(this.ringAim, tower.x, tower.z, tower.s.range); } else this.ringAim.visible = false;
  }
  setRing(line, x, z, r) {
    const a = line.geometry.attributes.position, w = this.world, hw = 0.16;
    for (let i = 0; i <= 96; i++) {
      const t = i / 96 * 6.2832, c = Math.cos(t), s = Math.sin(t), ix = x + c * (r - hw), iz = z + s * (r - hw), ox = x + c * (r + hw), oz = z + s * (r + hw);
      a.setXYZ(i * 2, ix, w.heightAt(ix, iz) + 0.3, iz); a.setXYZ(i * 2 + 1, ox, w.heightAt(ox, oz) + 0.3, oz);
    }
    a.needsUpdate = true; line.visible = true;
  }

  // ------------------------------------------------------------------ gathering
  updateGather(dt) {
    const p = this.player; p.hitCd -= dt;
    if (this.mouse.l && this.buildIdx < 0 && p.hitCd <= 0 && p.swingT < 0) { // begin a chop; the hit lands when the blade does, not on the click
      p.hitCd = SWING.total; p.swingT = 0; p.hitDone = false; p.whoosh = false; p.swingHit = false;
      p.swingTarget = this.aim?.kind === 'node' ? this.aim.ref : null;
    }
    this.tickSwing(dt, true);
  }
  // Advance the chop. `live` = gameplay is running (whoosh and hit fire); otherwise only the animation plays out.
  tickSwing(dt, live) {
    const p = this.player;
    if (p.swingT < 0) return;
    p.swingT += dt;
    if (live) {
      if (!p.whoosh && p.swingT >= SWING.windUp) { p.whoosh = true; this.sfx('swing'); }
      if (!p.hitDone && p.swingT >= SWING.impact) { p.hitDone = true; this.swingImpact(); }
    } else p.hitDone = true;
    if (p.swingT >= SWING.total) p.swingT = -1;
  }
  swingImpact() { // the blade lands: whatever is under the crosshair NOW takes the hit (or the node the swing was aimed at, if you are still beside it)
    const p = this.player;
    let n = this.aim?.kind === 'node' ? this.aim.ref : null;
    const st = p.swingTarget;
    if (!n && st && st.hits > 0 && Math.hypot(st.x - p.x, st.z - p.z) < REACH + 1.5) n = st;
    if (this.buildIdx >= 0) n = null;
    p.swingHit = !!n;
    if (!n) { this.fp.flash = 0.3; return; } // a miss: the swing just carries through
    const last = n.hits <= 1;
    this.hitNode(n); this.punch(last ? 1.6 : 1); this.fp.flash = 1;
    if (this.era === 'futuristic') this.cutterBeam(n);
  }
  punch(k) { const pu = this.punchS; pu.vx -= 0.55 * k; pu.vz += (rnd() - 0.5) * 0.55 * k; } // a thud: pitch dips, a touch of roll
  cutterBeam(n) { // plasma cutter: a quick bolt from the glowing tip to the node
    this.camera.updateMatrixWorld(true); this.toolTip.getWorldPosition(V0);
    const to = { x: n.x, y: this.world.heightAt(n.x, n.z) + 1.3, z: n.z };
    this.fx.beam(V0, to, 0x6fe8ff, 0.07, 0.12); this.fx.beam(V0, to, 0xffffff, 0.025, 0.08);
  }

  // Tool pose = the keyframed chop (swing.js) plus gentle layers: idle breathing, walk bob, sprint carry,
  // and a little lag behind fast camera turns. Every layer is eased, so nothing ever snaps.
  updateTool(dt) {
    const p = this.player, fp = this.fp, t = this.tool, B = this.toolBase, sp = Math.hypot(p.vx, p.vz);
    // Critically damped smoothing: a layer glides in with ZERO starting velocity (an exponential ease would lurch at the onset).
    const damp = (key, target, omega) => {
      const x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), ch = fp[key] - target, tmp = (fp.v[key] + omega * ch) * dt;
      fp.v[key] = (fp.v[key] - omega * tmp) * e; fp[key] = target + (ch + tmp) * e;
    };
    damp('move', p.onGround ? Math.min(1, sp / WALK) : 0, 10);
    damp('sprint', p.sprinting && sp > 6 ? 1 : 0, 9);
    damp('calm', p.swingT >= 0 ? 0.25 : 1, 16); // bob and sprint-carry fade while chopping so the swing stays clean
    let dyaw = p.yaw - fp.lastYaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const dpitch = p.pitch - fp.lastPitch, inv = dt > 0 ? 1 / dt : 0; fp.lastYaw = p.yaw; fp.lastPitch = p.pitch;
    damp('sx', clamp(dyaw * inv * 0.012, -0.06, 0.06), 12);
    damp('sy', clamp(-dpitch * inv * 0.010, -0.05, 0.05), 12);
    fp.flash = Math.max(0, fp.flash - dt * 7);
    const o = p.swingT >= 0 ? swingPose(this.era, p.swingT, p.swingHit, this.swPose) : ZERO_POSE;
    const ph = p.bob * 1.9, mv = fp.move * fp.calm, spr = fp.sprint * fp.calm;
    t.position.set(
      B.pos.x + o[0] + fp.sx + Math.cos(ph * 0.5) * 0.010 * mv,
      B.pos.y + o[1] + fp.sy - Math.abs(Math.sin(ph)) * 0.012 * mv - 0.05 * spr + Math.sin(this.t * 1.7) * 0.003,
      B.pos.z + o[2] + 0.03 * spr);
    t.rotation.set(
      B.rot.x + o[3] + fp.sy * 1.2 + 0.32 * spr,
      B.rot.y + o[4] - fp.sx * 0.8,
      B.rot.z + o[5] + fp.sx * 1.4 + Math.sin(ph * 0.5) * 0.022 * mv);
    if (this.toolTip) this.toolTip.material.emissiveIntensity = 1 + 3 * fp.flash; // the plasma tip flares on impact
    this.updateTrail(dt);
  }
  updateTrail(dt) {
    const tr = this.trail, p = this.player, fp = this.fp, B = this.toolBase, LIFE = 0.12;
    for (const s of tr.samples) s.age += dt;
    while (tr.samples.length && tr.samples[0].age > LIFE) tr.samples.shift();
    const t1 = p.swingT, t0 = fp.prevT; fp.prevT = t1;
    if (t1 >= 0 && t0 >= 0) { // sample the edge's exact path across this frame's slice of the strike, so the ribbon is smooth at any frame rate
      const lo = Math.max(t0, SWING.windUp - 0.015), hi = Math.min(t1, SWING.impact + 0.06);
      if (hi > lo) {
        const n = Math.max(1, Math.ceil((hi - lo) / 0.008)), g = tr.ghost;
        for (let i = 1; i <= n; i++) {
          const tau = lo + (hi - lo) * i / n, o = swingPose(this.era, tau, p.swingHit, tr.pose);
          g.position.set(B.pos.x + o[0], B.pos.y + o[1], B.pos.z + o[2]); g.rotation.set(B.rot.x + o[3], B.rot.y + o[4], B.rot.z + o[5]); g.scale.copy(this.tool.scale); g.updateMatrix();
          tr.samples.push({ a: tr.A.set(...this.bladeA).applyMatrix4(g.matrix).toArray(), b: tr.B.set(...this.bladeB).applyMatrix4(g.matrix).toArray(), age: t1 - tau });
        }
      }
    }
    while (tr.samples.length > tr.N) tr.samples.shift();
    const n = tr.samples.length;
    if (n < 2) { tr.mesh.visible = false; return; }
    const c = tr.color;
    for (let i = 0; i < n; i++) {
      const s = tr.samples[i], a = Math.pow(Math.max(0, 1 - s.age / LIFE), 1.5) * tr.alpha, v = i * 6, q = i * 8;
      tr.pos[v] = s.a[0]; tr.pos[v + 1] = s.a[1]; tr.pos[v + 2] = s.a[2]; tr.pos[v + 3] = s.b[0]; tr.pos[v + 4] = s.b[1]; tr.pos[v + 5] = s.b[2];
      tr.col[q] = c.r; tr.col[q + 1] = c.g; tr.col[q + 2] = c.b; tr.col[q + 3] = a;           // outer edge: brightest
      tr.col[q + 4] = c.r; tr.col[q + 5] = c.g; tr.col[q + 6] = c.b; tr.col[q + 7] = a * 0.3;  // inner edge fades out
    }
    tr.geo.attributes.position.needsUpdate = tr.geo.attributes.color.needsUpdate = true;
    tr.geo.setDrawRange(0, (n - 1) * 6); tr.mesh.visible = true;
  }
  hitNode(n) {
    const r = this.resList[n.type], w = this.world, y = w.heightAt(n.x, n.z), col = parseInt(r.color.slice(1), 16);
    n.hits--; n.shake = 0.28;
    this.res[r.id] += n.yield; this.stats.gathered += n.yield;
    const near = Math.hypot(n.x - this.player.x, n.z - this.player.z); // the pop-up starts where the blade hit and floats up; it is smaller when you chop from right beside the node
    this.fx.text(n.x, y + 1.9, n.z, `+${n.yield} ${r.name}`, r.color, 0.95 * Math.min(1, Math.max(0.4, near / 9)));
    this.fx.burst(n.x, y + 1.4, n.z, col, 8, 5, 0.5, 0.45, 9, 2);
    this.fx.stream({ x: n.x, y: y + 1.5, z: n.z }, { x: this.player.x, y: this.player.y + 1.2, z: this.player.z }, col, 4);
    this.sfx('gather');
    if (n.hits <= 0) {
      n.respawn = NODE_RESPAWN[n.type]; n.mesh.visible = false;
      this.fx.burst(n.x, y + 1.2, n.z, col, 22, 8, 0.8, 0.7, 8, 3);
      this.sfx('pickup');
    }
  }
  updateNodes(dt) {
    for (const n of this.world.nodes) {
      if (n.shake > 0) { n.shake -= dt; n.mesh.rotation.z = Math.sin(this.t * 70) * n.shake * 0.35; if (n.shake <= 0) n.mesh.rotation.z = 0; }
      if (n.hits <= 0) { n.respawn -= dt; if (n.respawn <= 0) { n.hits = n.max; n.mesh.visible = true; n.grow = 0; } }
      if (n.grow < 1) { n.grow = Math.min(1, n.grow + dt * 1.6); n.mesh.scale.setScalar(Math.max(0.01, 1 - Math.pow(1 - n.grow, 3))); }
    }
  }

  // ------------------------------------------------------------------ building
  select(i) {
    if (this.state !== 'playing' || i < 0 || i >= this.defs.length) return;
    this.buildIdx = this.buildIdx === i ? -1 : i;
    this.setupGhost();
    this.sfx('click');
  }
  cancelBuild() { if (this.buildIdx >= 0) { this.buildIdx = -1; this.setupGhost(); } }
  setupGhost() {
    if (this.ghost) { this.scene.remove(this.ghost); disposeTree(this.ghost); this.ghost = null; }
    this.ringMain.visible = this.ringMin.visible = false;
    if (this.buildIdx < 0) return;
    const root = towerModel(this.defs[this.buildIdx].id);
    root.traverse(o => { if (o.isMesh) { o.material.dispose(); o.material = this.pm.ghost; } });
    root.visible = false; this.scene.add(root); this.ghost = root;
  }
  groundRay() { // where the crosshair meets the terrain
    const w = this.world, c = this.camera.position, d = this.fwd, step = 0.8;
    for (let t = step; t < 80; t += step) {
      const x = c.x + d.x * t, y = c.y + d.y * t, z = c.z + d.z * t;
      if (y < w.heightAt(x, z)) {
        let lo = t - step, hi = t;
        for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (c.y + d.y * m < w.heightAt(c.x + d.x * m, c.z + d.z * m)) hi = m; else lo = m; }
        const px = c.x + d.x * hi, pz = c.z + d.z * hi;
        return { x: px, y: w.heightAt(px, pz), z: pz };
      }
    }
    return null;
  }
  checkPlace(x, z) {
    const w = this.world, p = this.player;
    if (Math.abs(x) > HALF - 8 || Math.abs(z) > HALF - 8) return 'Too close to the edge of the world';
    if (w.distToPath(x, z) < 4.6) return 'Too close to the road';
    if (Math.hypot(x - w.spawnPos.x, z - w.spawnPos.z) < 14) return 'Too close to the enemy gate';
    if (Math.hypot(x - w.basePos.x, z - w.basePos.z) < 12) return 'Too close to your base';
    for (const tw of this.towers) if (Math.hypot(tw.x - x, tw.z - z) < TOWER_GAP) return 'Too close to another tower';
    const wt = w.water; if (wt && w.heightAt(x, z) < wt.level - 0.3) return wt.kind === 'lava' ? 'Can\'t build in lava' : wt.kind === 'ice' ? 'Can\'t build on the ice' : 'Can\'t build in water';
    for (const n of w.nodes) if (n.hits > 0 && Math.hypot(n.x - x, n.z - z) < 3.4) return 'Blocked by a resource node';
    if (Math.hypot(x - p.x, z - p.z) > BUILD_RANGE) return 'Too far away';
    let lo = 1e9, hi = -1e9;
    for (const [dx, dz] of [[0, 0], [2.3, 0], [-2.3, 0], [0, 2.3], [0, -2.3]]) { const h = w.heightAt(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > 2.7) return 'Ground is too steep';
    return null;
  }
  groundMin(x, z) { let lo = 1e9; for (const [dx, dz] of [[0, 0], [2.3, 0], [-2.3, 0], [0, 2.3], [0, -2.3]]) lo = Math.min(lo, this.world.heightAt(x + dx, z + dz)); return lo; }

  updateBuild() {
    const edge = this.mouse.lEdge; this.mouse.lEdge = false;
    if (this.buildIdx < 0 || !this.ghost) { this.ghostInfo.ok = false; return; }
    const def = this.defs[this.buildIdx], hit = this.groundRay(), gi = this.ghostInfo;
    gi.afford = this.canAfford(def.cost);
    if (!hit) { gi.ok = false; gi.reason = 'Aim at the ground'; this.ghost.visible = false; this.ringMain.visible = this.ringMin.visible = false; return; }
    const reason = this.checkPlace(hit.x, hit.z);
    gi.x = hit.x; gi.z = hit.z; gi.reason = reason || (gi.afford ? '' : `Need more ${this.missing(def.cost)}`); gi.ok = !reason && gi.afford;
    this.ghost.visible = true; this.ghost.position.set(hit.x, this.groundMin(hit.x, hit.z) - 0.1, hit.z);
    const tow = this.pointToward(hit.x, hit.z); if (this.ghost.userData.head) this.ghost.userData.head.rotation.y = tow;
    this.pm.ghost.color.setHex(gi.ok ? 0x66ff99 : 0xff6666); this.pm.ghost.emissive.setHex(gi.ok ? 0x114422 : 0x551111);
    this.ringMain.material.color.setHex(gi.ok ? 0x9fffc0 : 0xff9090).multiplyScalar(1.5);
    this.setRing(this.ringMain, hit.x, hit.z, def.range);
    if (def.minRange) this.setRing(this.ringMin, hit.x, hit.z, def.minRange); else this.ringMin.visible = false;
    if (edge) this.tryBuild(def, hit);
  }
  pointToward(x, z) { // yaw that faces the nearest stretch of road
    const pts = this.world.pts; let best = 1e9, bx = 0, bz = 0;
    for (let i = 0; i < pts.length; i += 3) { const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2; if (d < best) { best = d; bx = pts[i].x; bz = pts[i].z; } }
    return Math.atan2(bx - x, bz - z);
  }
  tryBuild(def, hit) {
    const gi = this.ghostInfo;
    if (!gi.ok) { this.sfx('error'); this.toast(gi.reason || 'Cannot build here', 'warn'); return null; }
    return this.placeTower(def, hit.x, hit.z);
  }
  placeTower(def, x, z) {
    this.spend(def.cost);
    const mesh = towerModel(def.id), y = this.groundMin(x, z) - 0.1, head = mesh.userData.head;
    mesh.position.set(x, y, z); head.rotation.y = this.pointToward(x, z);
    shade(mesh); this.scene.add(mesh);
    const tw = { def, id: def.id, mesh, head, x, z, y, level: 1, spent: { ...def.cost }, s: statsFor(def, 1), h: new THREE.Box3().setFromObject(mesh).max.y - y, pips: null };
    initTower(tw); this.towers.push(tw); this.stats.built++;
    this.fx.burst(x, y + 0.5, z, 0xcbb894, 16, 5, 0.7, 0.8, 9, 2); this.fx.ring(x, y, z, def.color, 5, 0.6, 0.15);
    this.sfx('build');
    if (this.pvp) this.relay({ k: 'built', id: def.id });
    return tw;
  }

  upgradeCost(tw) { const c = {}; for (const k in tw.def.cost) c[k] = Math.ceil(tw.def.cost[k] * 0.8 * tw.level); return c; }
  upgrade(tw) {
    if (tw.level >= MAX_LEVEL) return this.toast(`${tw.def.name} is already at max level`, 'warn');
    const c = this.upgradeCost(tw);
    if (!this.canAfford(c)) { this.sfx('error'); return this.toast(`Need more ${this.missing(c)}`, 'warn'); }
    this.spend(c); for (const k in c) tw.spent[k] += c[k];
    tw.level++; tw.s = statsFor(tw.def, tw.level);
    tw.mesh.scale.setScalar(1 + 0.05 * (tw.level - 1));
    if (!tw.pips) { tw.pips = new THREE.Group(); tw.mesh.add(tw.pips); }
    tw.pips.add(new THREE.Mesh(this.pg.pip, this.pm.pip));
    tw.pips.children.forEach((c, i, all) => c.position.set((i - (all.length - 1) / 2) * 0.7, tw.h + 1.1, 0)); // keep the pips centred
    this.fx.flash(tw.x, tw.y + tw.h * 0.6, tw.z, 0xffe08a, 3.2, 0.4); this.fx.ring(tw.x, tw.y, tw.z, 0xffd84d, 6, 0.6, 0.12);
    this.sfx('build');
    this.toast(`${tw.def.name} upgraded to level ${tw.level}`, 'good');
  }
  refund(tw) { const r = {}; for (const k in tw.spent) r[k] = Math.floor(tw.spent[k] * 0.6); return r; }
  sellPress(tw) { // needs a second press shortly after the first so a stray key can't delete a tower
    if (this.sellArm && this.sellArm.tw === tw && this.t < this.sellArm.until) return this.sell(tw);
    this.sellArm = { tw, until: this.t + 2 };
    this.toast(`Press R again to sell ${tw.def.name}`, 'warn');
  }
  sell(tw) {
    const r = this.refund(tw); for (const k in r) this.res[k] += r[k];
    this.towers.splice(this.towers.indexOf(tw), 1);
    this.scene.remove(tw.mesh); disposeTree(tw.mesh);
    this.fx.burst(tw.x, tw.y + 1, tw.z, 0xcbb894, 14, 5, 0.6, 0.7, 9, 2);
    this.sfx('pickup'); this.sellArm = null; this.ringAim.visible = false;
    this.toast(`Sold ${tw.def.name}`, 'info');
  }

  // ------------------------------------------------------------------ waves
  updateWaves(dt) {
    this.nextWaveIn -= dt;
    if (this.nextWaveIn <= 0 && this.wave < this.waveTotal) this.startWave();
    while (this.queue.length && this.queue[0].at <= this.t) { const q = this.queue.shift(); this.spawnEnemy(q.type, q.mul, q.sab, q.spd); }
  }
  startWave() {
    const n = ++this.wave, mul = hpMul(n, this.hpCfg), spd = speedMul(n);
    for (const s of planWave(n, this.seed)) this.queue.push({ at: this.t + s.t, type: s.type, mul, spd });
    this.queue.sort((a, b) => a.at - b.at);
    this.nextWaveIn = this.wave >= this.waveTotal ? Infinity : this.timing.gap;
    const drop = 8 + n, r = this.resList; this.res[r[0].id] += drop; this.res[r[1].id] += drop;
    let extra = ''; if (n % 3 === 0) { this.res[r[2].id] += 3; extra = ` +3 ${r[2].name}`; }
    this.ui.banner?.(`WAVE ${n}`, isBossWave(n) ? 'A COLOSSUS APPROACHES' : waveSummary(n).map(g => `${g.count}× ${ENEMIES[g.type].name}`).join('  ·  '));
    this.toast(`Supply drop: +${drop} ${r[0].name}, +${drop} ${r[1].name}${extra}`, 'good');
    this.sfx('wave'); this.shake(0.2);
    if (this.pvp) this.relay({ k: 'wave', n });
  }
  callWave() {
    if (this.pvp || this.state !== 'playing' || this.wave >= this.waveTotal || !isFinite(this.nextWaveIn)) return;
    const bonus = Math.floor(this.nextWaveIn / 5), r = this.resList;
    if (bonus > 0) { this.res[r[0].id] += bonus; this.res[r[1].id] += bonus; this.toast(`Early call bonus: +${bonus} ${r[0].name}, +${bonus} ${r[1].name}`, 'good'); }
    this.nextWaveIn = 0;
  }

  // ------------------------------------------------------------------ enemies
  spawnEnemy(type, mul, sab = false, spd = 1) {
    const def = ENEMIES[type];
    let tpl = this.tpl[type];
    if (!tpl) { const m = enemyModel(this.era, type); shade(m); tpl = this.tpl[type] = { model: m, h: Math.max(1.2, new THREE.Box3().setFromObject(m).max.y) }; }
    const mesh = tpl.model.clone(true); this.scene.add(mesh);
    const e = {
      id: ++this.eid, type, def, mesh, h: tpl.h, d: 0, lane: (rnd() - 0.5) * 2.6, hp: def.hp * mul, max: def.hp * mul, x: 0, y: 0, z: 0,
      spd, limbs: collectLimbs(mesh), vNow: def.speed * spd, slowUntil: 0, slowMul: 1, stunUntil: 0, burnUntil: 0, burnDps: 0, burnT: 0, pull: 0, pop: 0, alive: true, phase: rnd() * 6, bar: null, sab, _dist: 0,
      frostUntil: 0, pulledUntil: 0, pullX: 0, pullZ: 0, fxT: 0, st: null,
    };
    if (this.vis) e.st = new EnemyStatus(mesh, tpl.h, def.size, this.skit);
    this.placeEnemy(e); this.enemies.push(e);
    if (type === 'boss') this.shake(0.3);
  }
  // compile the enemies' shaders (status looks and all) behind the loading screen: one of each type is spawned, compiled and removed
  warm(compile) {
    if (!this.vis) return;
    const list = [];
    for (const type in ENEMIES) { this.spawnEnemy(type, 1); const e = this.enemies[this.enemies.length - 1]; e.st.update(0, 0, { frost: true, burn: true, pull: true, stun: true }); list.push(e); }
    compile();
    for (const e of list) { e.alive = false; this.removeEnemyVisuals(e); }
    this.enemies = []; this.eid = 0; this.shakeAmt = 0;
  }
  placeEnemy(e) {
    const p = this.posAt(e.d, e.lane), a = this.world.pointAt(Math.max(0, e.d - 1), P0), b = this.world.pointAt(e.d + 1, P1);
    e.x = p.x; e.y = p.y; e.z = p.z;
    const bob = Math.abs(Math.sin(this.t * (3 + e.def.speed) + e.phase)) * 0.14 * (e.stunUntil > this.t ? 0 : 1);
    e.mesh.position.set(p.x, p.y + bob, p.z);
    e.mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    const s = 1 + (e.pop > 0 ? e.pop * 1.6 : 0); e.mesh.scale.setScalar(s);
    animateEnemy(e.limbs, this.t, e.vNow, e.phase, STRIDE[e.type]);
  }
  makeBar(e) {
    const g = new THREE.Group(), bg = new THREE.Mesh(this.pg.plane, this.pm.barBg), fg = new THREE.Mesh(this.pg.planeL, this.pm.barG);
    fg.position.set(-0.5, 0, 0.01); g.add(bg, fg); g.scale.set(0.9 + e.def.size * 0.55, 0.16, 1); g.renderOrder = 8;
    this.scene.add(g); e.bar = { g, fg };
  }
  damage(e, amt, kind) {
    if (!e.alive || !(amt > 0)) return;
    e.hp -= amt;
    if (e.pop <= 0 && amt >= 2) e.pop = 0.1;
    if (e.st && amt >= 2 && !QUIET[kind]) e.st.flash(clamp(0.5 + 3 * amt / e.max, 0.5, 1));
    if (e.hp < e.max && !e.bar) this.makeBar(e);
    if (e.hp <= 0) this.kill(e);
  }
  kill(e) {
    e.alive = false; this.dirty = true; this.stats.kills++;
    const fut = this.era === 'futuristic', big = e.def.size > 1.2, y = e.y + e.h * 0.5;
    this.fx.burst(e.x, y, e.z, fut ? 0x4de3ff : 0xc4ae84, 8 + (big ? 14 : 0), 5 + e.def.size, 0.6, (fut ? 0.5 : 0.3) + e.def.size * (fut ? 0.3 : 0.2), 10, 2);
    if (fut) this.fx.burst(e.x, y, e.z, 0xff4de1, 4, 4, 0.5, 0.4, 6, 1);
    this.sfx('die', e.x, e.z, big ? 1 : 0.7);
    if (e.type === 'boss') { this.fx.flash(e.x, y, e.z, fut ? 0xff4de1 : 0xffd84d, 7, 0.6); this.shake(0.7, e.x, e.z); this.toast('The Colossus has fallen!', 'good'); this.sfx('boom'); }
    if (e.st) this.beginDeath(e); else this.removeEnemyVisuals(e);
  }
  // the body stays for a moment and falls apart: stone crumbles to dust (ancient), the hull dissolves into neon shards (futuristic)
  beginDeath(e) {
    if (e.bar) { this.scene.remove(e.bar.g); e.bar = null; }
    const fut = this.era === 'futuristic', big = e.def.size > 1.2, boss = e.type === 'boss', size = e.def.size;
    const dur = (fut ? 0.55 : 0.9) * (boss ? 1.5 : big ? 1.2 : 1);
    e.st.startDie(dur);
    this.dying.push({ e, age: 0, dur, y0: e.mesh.position.y });
    const n = Math.round((boss ? 30 : big ? 16 : 8) * (size > 0.6 ? 1 : 0.6));
    if (fut) this.fx.shatter(e.x, e.y + e.h * 0.5, e.z, size, n * 1.4, e.y);
    else { this.fx.crumble(e.x, e.y + e.h * 0.5, e.z, size, n, e.y); this.fx.burst(e.x, e.y + 0.3, e.z, 0x7a6a4c, 5 + (big ? 6 : 0), 2.2, 1.0, 0.5 + size * 0.25, -0.4, 0.5); }
    if (this.t < e.burnUntil) this.fx.scorch('fire', e.x, e.z, 0.9 + size * 0.5, 0.9);
  }
  updateDying(dt) {
    const fut = this.era === 'futuristic';
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i], m = d.e.mesh, k = d.e.st.die(dt);
      d.age += dt;
      if (fut) { const j = (1 - k) * 0.1; m.scale.set(1 + (Math.random() - 0.5) * j, 1 + (Math.random() - 0.5) * j, 1 + (Math.random() - 0.5) * j); }   // the hull glitches as it breaks up
      else { m.scale.set(1 + k * 0.12, 1 - k * 0.5, 1 + k * 0.12); m.position.y = d.y0 - k * 0.2; }                                                 // slumps as it crumbles
      if (k >= 1) { this.scene.remove(m); this.dying.splice(i, 1); }
    }
  }
  removeEnemyVisuals(e) {
    this.scene.remove(e.mesh);
    if (e.bar) { this.scene.remove(e.bar.g); e.bar = null; }
  }
  leak(e) {
    e.alive = false; this.dirty = true; this.stats.leaks++;
    this.baseHp = Math.max(0, this.baseHp - e.def.dmg);
    const b = this.world.basePos, y = this.world.heightAt(b.x, b.z) + 4;
    this.fx.burst(b.x, y, b.z, 0xff4040, 18, 8, 0.8, 0.9, 5, 2); this.fx.flash(b.x, y, b.z, 0xff3030, 6, 0.4, 0.5);
    this.sfx('leak'); this.shake(0.6 + e.def.dmg * 0.05); this.hitFlash = 0.5; this.ui.hit?.();
    this.removeEnemyVisuals(e);
    if (this.pvp) this.stTimer = 0;
  }
  slow(e, mul, dur, kind) {
    if (this.t >= e.slowUntil) e.slowMul = mul; else e.slowMul = Math.min(e.slowMul, mul);
    e.slowUntil = Math.max(e.slowUntil, this.t + dur);
    if (kind === 'frost') e.frostUntil = Math.max(e.frostUntil, this.t + dur);   // only cold slows look frozen (gravity slows look like gravity)
  }
  stun(e, dur) { e.stunUntil = Math.max(e.stunUntil, this.t + dur); this.fx.burst(e.x, e.y + e.h + 0.4, e.z, 0xffe680, 5, 2, 0.5, 0.45, 0, 1); }
  ignite(e, dps, dur) {
    const lit = this.t < e.burnUntil;
    e.burnDps = lit ? Math.max(e.burnDps, dps) : dps; e.burnUntil = Math.max(e.burnUntil, this.t + dur);
    if (!lit) e.burnT = 0.15;
  }

  updateEnemies(dt) {
    if (this.dirty) { this.enemies = this.enemies.filter(e => e.alive); this.dirty = false; }
    const t = this.t, end = this.world.pathLen - 0.6, cq = this.camera.quaternion;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      let mul = t < e.slowUntil ? e.slowMul : 1; if (t < e.stunUntil) mul = 0;
      e.vNow = e.def.speed * e.spd * mul;
      const pulled = e.pull > 0; if (pulled) e.pulledUntil = t + 0.25;
      e.d = Math.max(0, e.d + e.vNow * dt - e.pull * dt); e.pull = 0;
      if (t < e.burnUntil) {
        e.burnT -= dt;
        if (e.burnT <= 0) {
          e.burnT = 0.4;
          this.damage(e, e.burnDps * 0.4, 'burn');
          if (!e.alive) continue;
          this.fx.burst(e.x, e.y + e.h * 0.7, e.z, 0xff8a2a, 3, 2.5, 0.5, 0.55, -3, 1);
          for (const o of this.enemies) { // flames leap to nearby enemies, a little weaker each hop
            if (o === e || !o.alive || t < o.burnUntil) continue;
            if ((o.x - e.x) ** 2 + (o.z - e.z) ** 2 < 10.2 && rnd() < 0.45) this.ignite(o, e.burnDps * 0.75, 2.6);
          }
        }
      }
      if (e.d >= end) { this.leak(e); continue; }
      if (e.pop > 0) e.pop = Math.max(0, e.pop - dt);
      this.placeEnemy(e);
      if (e.bar) {
        const r = Math.max(0, e.hp / e.max);
        e.bar.g.position.set(e.x, e.y + e.h + 0.7, e.z); e.bar.g.quaternion.copy(cq);
        e.bar.fg.scale.x = r; e.bar.fg.material = r > 0.55 ? this.pm.barG : r > 0.28 ? this.pm.barY : this.pm.barR;
      }
      if (t < e.slowUntil && rnd() < 0.05) this.fx.burst(e.x, e.y + e.h * 0.5, e.z, 0x9fe4ff, 1, 1.5, 0.5, 0.3, -1, 0.3);
      if (e.st) this.statusFx(e, dt, t);
    }
  }
  // what the enemy's status looks like this frame: shader uniforms plus a few particles (flames, frost glitter, gravity streaks)
  statusFx(e, dt, t) {
    const burning = t < e.burnUntil, frozen = t < e.frostUntil, pulled = t < e.pulledUntil, stunned = t < e.stunUntil;
    e.st.update(dt, t, { frost: frozen, burn: burning, pull: pulled, stun: stunned });
    const cam = this.camera.position, dx = e.x - cam.x, dz = e.z - cam.z;
    if (dx * dx + dz * dz > 95 * 95 || !(burning || frozen || pulled)) return;   // too far to see, or nothing to show
    e.fxT -= dt; if (e.fxT > 0) return;
    const s = e.def.size, R = Math.random, fut = this.era === 'futuristic';
    if (burning) {
      e.fxT = 0.028 + R() * 0.03;   // tongues of fire: many small, quick sprites rising off the body (hot yellow core, orange body)
      const a = R() * 6.283, r = s * 0.32 * Math.sqrt(R()), y = e.y + e.h * (0.08 + R() * 0.7), k = 0.7 + s * 0.35;
      this.fx.emit(e.x + Math.cos(a) * r, y, e.z + Math.sin(a) * r, (R() - 0.5) * 0.7, 1.8 + R() * 1.6, (R() - 0.5) * 0.7, R() < 0.35 ? 0xffd060 : 0xff6a1a, 0.22 + R() * 0.2, (0.26 + R() * 0.26) * k, -2.5, 0.8);
      if (R() < 0.18) this.fx.emit(e.x + (R() - 0.5) * s * 0.5, e.y + e.h * 0.85, e.z + (R() - 0.5) * s * 0.5, (R() - 0.5), 2.6 + R() * 1.6, (R() - 0.5), 0xff9a3a, 0.8 + R() * 0.5, 0.14, -1, 0.3);   // an ember
    } else if (frozen) {
      e.fxT = 0.12 + R() * 0.1;
      const a = R() * 6.283, r = s * 0.4 * R();
      this.fx.emit(e.x + Math.cos(a) * r, e.y + e.h * (0.15 + R() * 0.8), e.z + Math.sin(a) * r, (R() - 0.5) * 0.5, 0.2 + R() * 0.4, (R() - 0.5) * 0.5, R() < 0.5 ? 0xbfeaff : 0xffffff, 0.7 + R() * 0.5, 0.2 + R() * 0.12, 1.2, 0.4);
    } else {
      e.fxT = 0.04 + R() * 0.03;   // gravity: streaks racing towards the well
      const tx = e.pullX - e.x, tz = e.pullZ - e.z, l = Math.hypot(tx, tz) || 1, v = 9;
      this.fx.emit(e.x + (R() - 0.5) * s * 0.6, e.y + e.h * (0.15 + R() * 0.75), e.z + (R() - 0.5) * s * 0.6, tx / l * v, (R() - 0.5), tz / l * v, R() < 0.5 ? 0xb070ff : 0xe0c0ff, 0.22 + R() * 0.12, 0.34 + R() * 0.2, 0, 0.2);
    }
  }


  // ------------------------------------------------------------------ towers + projectiles
  updateTowers(dt) {
    for (const tw of this.towers) { AI[tw.id](this, tw, dt); animateTower(tw, this.t, dt); }
  }
  launch(p) {
    const pr = { ...p, t: 0, from: { x: p.from.x, y: p.from.y, z: p.from.z } };
    let mesh;
    if (p.kind === 'bolt') {
      mesh = new THREE.Group(); mesh.add(new THREE.Mesh(this.pg.shaft, this.pm.bolt), new THREE.Mesh(this.pg.head, this.pm.boltHead));
      mesh.position.set(p.from.x, p.from.y, p.from.z); mesh.lookAt(p.to.x, p.to.y, p.to.z);
    } else if (p.kind === 'boulder') { mesh = new THREE.Mesh(this.pg.boulder, this.pm.boulder); mesh.position.set(p.from.x, p.from.y, p.from.z); }
    else { mesh = new THREE.Mesh(this.pg.fire, this.pm.fire); mesh.position.set(p.from.x, p.from.y, p.from.z); pr.pos = { ...pr.from }; }
    this.scene.add(mesh); pr.mesh = mesh; this.proj.push(pr);
  }
  updateProjectiles(dt) {
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i]; p.t += dt;
      let done = false;
      if (p.kind === 'bolt') {
        const k = Math.min(1, p.t / p.dur);
        p.mesh.position.set(p.from.x + (p.to.x - p.from.x) * k, p.from.y + (p.to.y - p.from.y) * k, p.from.z + (p.to.z - p.from.z) * k);
        done = k >= 1;
      } else if (p.kind === 'boulder') {
        const k = Math.min(1, p.t / p.dur);
        p.mesh.position.set(p.from.x + (p.to.x - p.from.x) * k, p.from.y + (p.to.y - p.from.y) * k + p.arc * 4 * k * (1 - k), p.from.z + (p.to.z - p.from.z) * k);
        p.mesh.rotation.x += dt * 5; p.mesh.rotation.z += dt * 3;
        if (rnd() < 0.5) this.fx.burst(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0x8a7a5a, 1, 0.8, 0.35, 0.4, 0, 0);
        if (k >= 1) { p.land(p.to); done = true; }
      } else { // homing fireball
        const tg = p.target, ps = p.pos;
        if (tg.alive) { p.last = { x: tg.x, y: tg.y + tg.h * 0.6, z: tg.z }; }
        const to = p.last || { x: tg.x, y: tg.y + tg.h * 0.6, z: tg.z }, dx = to.x - ps.x, dy = to.y - ps.y, dz = to.z - ps.z, d = Math.hypot(dx, dy, dz), step = p.speed * dt;
        if (d <= step + 0.5) { if (tg.alive) p.hit(tg); this.fx.burst(to.x, to.y, to.z, 0xff9a30, 6, 4, 0.35, 0.5, 2, 1); done = true; }
        else { ps.x += dx / d * step; ps.y += dy / d * step; ps.z += dz / d * step; p.mesh.position.set(ps.x, ps.y, ps.z); this.fx.emit(ps.x, ps.y, ps.z, (rnd() - 0.5), 0.5, (rnd() - 0.5), 0xff7a1a, 0.3, 0.7, 0, 0); }
        if (p.t > 3) done = true;
      }
      if (done) { this.scene.remove(p.mesh); if (p.kind === 'bolt') p.mesh.clear?.(); this.proj.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------------ housekeeping each frame
  updateMisc(dt) {
    // reveal resource nodes near you on the minimap
    this.discoverT -= dt;
    if (this.discoverT <= 0) { this.discoverT = 0.3; const p = this.player; for (const n of this.world.nodes) if (!n.seen && (n.x - p.x) ** 2 + (n.z - p.z) ** 2 < 34 * 34) n.seen = true; }
    // music gets more intense as the field fills up
    if (this.music) { const target = 0.3 + 0.6 * Math.min(1, this.enemies.length / 30); this.music.intensity += (target - this.music.intensity) * Math.min(1, dt * 0.6); }
    if (this.pvp) {
      this.sendCd = Math.max(0, this.sendCd - dt);
      this.stTimer -= dt;
      if (this.stTimer <= 0) { this.stTimer = 1; this.relay({ k: 'st', hp: this.baseHp, max: this.baseMax, wave: this.wave, towers: this.towers.length, kills: this.stats.kills }); }
    }
  }

  // ------------------------------------------------------------------ duel
  relay(data) { this.net?.send({ type: 'relay', data }); }
  sendEnemies(i) {
    if (!this.pvp || this.state !== 'playing') return;
    const s = SENDS[i]; if (!s) return;
    if (this.sendCd > 0) return this.toast(`Sabotage recharging (${Math.ceil(this.sendCd)}s)`, 'warn');
    const cost = this.tierCost(s.cost);
    if (!this.canAfford(cost)) { this.sfx('error'); return this.toast(`Need more ${this.missing(cost)}`, 'warn'); }
    this.spend(cost); this.sendCd = SEND_COOLDOWN;
    this.relay({ k: 'send', type: s.type, n: s.n });
    this.sfx('wave'); this.feed(`You sent ${s.n}× ${ENEMIES[s.type].name} at ${this.opp.name}`);
  }
  onRelay(d) {
    if (!this.pvp || !d || typeof d !== 'object') return;
    switch (d.k) {
      case 'st': this.opp.hp = +d.hp || 0; this.opp.max = +d.max || this.opp.max; this.opp.wave = d.wave | 0; this.opp.towers = d.towers | 0; this.opp.kills = d.kills | 0; break;
      case 'built': { const def = this.defs.find(x => x.id === d.id); if (def) this.feed(`${this.opp.name} built a ${def.name}`); break; }
      case 'send': {
        if (this.state !== 'playing' || !ENEMIES[d.type]) break;
        const n = clamp(d.n | 0, 1, 20), w = Math.max(1, this.wave), mul = hpMul(w, this.hpCfg), spd = speedMul(w);
        for (let i = 0; i < n; i++) this.queue.push({ at: this.t + 0.4 + i * 0.4, type: d.type, mul, spd, sab: true });
        this.queue.sort((a, b) => a.at - b.at);
        this.ui.banner?.('INCOMING!', `${this.opp.name} sent ${n}× ${ENEMIES[d.type].name}`);
        this.sfx('leak'); this.feed(`${this.opp.name} sent you ${n}× ${ENEMIES[d.type].name}`);
        break;
      }
      case 'dead':
        if (this.state === 'playing') this.finish(true, 'rival-fell');
        else if (this.state === 'lost') this.ui.draw?.();
        break;
    }
  }
  onMatchEnd() { if (this.pvp && this.state === 'playing') this.finish(true, 'rival-left'); }

  // ------------------------------------------------------------------ end of game
  checkEnd() {
    if (this.baseHp <= 0) return this.finish(false, 'base-fell');
    if (!this.pvp && this.wave >= this.waveTotal && this.queue.length === 0 && this.enemies.every(e => !e.alive)) this.finish(true, 'cleared');
  }
  finish(won, reason) {
    if (this.state !== 'playing') return;
    this.state = won ? 'won' : 'lost'; this.stats.time = this.t;
    this.cancelBuild(); this.mouse.l = false;
    this.sfx(won ? 'win' : 'lose');
    if (this.pvp) {
      if (!won && reason === 'base-fell') this.relay({ k: 'dead' });
      this.net?.send({ type: 'leaveMatch' });
    }
    try { this.dom.document?.exitPointerLock?.(); } catch {}
    this.ui.end?.({ won, reason, stats: { ...this.stats }, wave: this.wave, waves: this.waveTotal, mode: this.mode, opponent: this.opp?.name, hp: this.baseHp, towers: this.towers.length });
  }

  dispose() {
    for (const [t, ev, fn] of this.h || []) t.removeEventListener(ev, fn);
    this.h = [];
    this.fx.dispose();
    disposeTree(this.scene);
    for (const t of Object.values(this.tpl)) disposeTree(t.model);
    for (const g of Object.values(this.pg)) g.dispose();
    for (const m of Object.values(this.pm)) m.dispose();
    this.skit?.dispose();
    try { this.dom.document?.exitPointerLock?.(); } catch {}
  }
}
