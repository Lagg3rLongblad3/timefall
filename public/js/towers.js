// Tower behaviours. AI[id](g, tw, dt) runs every frame for one tower; `g` is the Game.
// Every tower type attacks differently on purpose - that is the whole point of the arsenal.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const M1 = new THREE.Vector3();

// Shot origin: [height, forward offset] in the rotating head's frame.
export const MUZZLE = {
  ballista: [2.05, 2.0], catapult: [2.8, 0], brazier: [3.6, 0], totem: [4.6, 0], obelisk: [6.2, 0], sphinx: [2.4, 1.6],
  laser: [1.75, 2.0], railgun: [1.9, 4.4], tesla: [4.5, 0], gravity: [2.6, 0], hive: [3.5, 0], nova: [3.0, 0],
};

// Stats of a tower at a given level (1..3): every level adds damage, reach and speed; some specials grow too.
export function statsFor(def, level) {
  const l = level - 1, s = { ...def };
  s.dmg = def.dmg * (1 + 0.5 * l);
  s.range = def.range * (1 + 0.08 * l);
  s.cd = def.cd * (1 - 0.1 * l);
  if (def.burn) s.burn = def.burn * (1 + 0.4 * l);
  if (def.splash) s.splash = def.splash * (1 + 0.12 * l);
  if (def.chain) s.chain = def.chain + l;
  if (def.multi) s.multi = def.multi + l;
  if (def.ramp) s.ramp = def.ramp * (1 + 0.3 * l);
  if (def.pull) s.pull = def.pull * (1 + 0.15 * l);
  if (def.stun) s.stun = def.stun * (1 + 0.15 * l);
  if (def.slow) s.slow = Math.min(0.75, def.slow + 0.06 * l);
  return s;
}

export function initTower(tw) {
  tw.cd = 0.5; tw.charge = 0; tw.lock = null; tw.lockT = 0; tw.kick = 0; tw.armT = 0; tw.hum = 0;
  tw.orbit = Math.random() * 6; tw.pulse = 0;
  tw.parts = {};
  tw.mesh.traverse(o => { if (o.name) (tw.parts[o.name] ||= []).push(o); });
  if (tw.def.id === 'hive') tw.drones = [0, 1, 2].map(i => ({ obj: tw.parts['drone' + i][0], cd: i * 0.25 }));
}

// idle animation shared by every tower
export function animate(tw, t, dt) {
  const p = tw.parts;
  if (p.spin) for (const o of p.spin) o.rotation.y += dt * 1.4;
  if (p.spin2) for (const o of p.spin2) o.rotation.x += dt * 1.9;
  if (p.flame) for (const o of p.flame) o.scale.set(1 + Math.sin(t * 13 + tw.orbit) * 0.1, 1 + Math.sin(t * 9 + tw.orbit) * 0.18, 1);
  if (p.flame2) for (const o of p.flame2) o.scale.set(1, 1 + Math.sin(t * 15 + tw.orbit) * 0.25, 1);
  if (p.orb) for (const o of p.orb) o.scale.setScalar(1 + Math.sin(t * 14) * 0.08);
  if (tw.head) { // recoil kick-back along the facing direction
    if (tw.kick > 0) tw.kick = Math.max(0, tw.kick - dt * 5);
    const f = tw.head.rotation.y, k = tw.kick * 0.45;
    tw.head.position.set(-Math.sin(f) * k, 0, -Math.cos(f) * k);
  }
}

const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
function aim(tw, tx, tz, dt, speed = 9) {
  const head = tw.head, want = Math.atan2(tx - tw.x, tz - tw.z), d = angDiff(head.rotation.y, want), step = speed * dt;
  head.rotation.y += Math.abs(d) <= step ? d : Math.sign(d) * step;
}
const aimed = (tw, tx, tz, tol = 0.3) => Math.abs(angDiff(tw.head.rotation.y, Math.atan2(tx - tw.x, tz - tw.z))) < tol;
function muzzle(tw, out = M1) {
  const [my, mz] = MUZZLE[tw.def.id], f = tw.head.rotation.y;
  return out.set(tw.x + Math.sin(f) * mz, tw.y + my, tw.z + Math.cos(f) * mz);
}
const first = list => { let b = null; for (const e of list) if (!b || e.d > b.d) b = e; return b; };
const center = e => ({ x: e.x, y: e.y + e.h * 0.55, z: e.z });
function segDist(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  return Math.hypot(ax + abx * t - px, ay + aby * t - py, az + abz * t - pz);
}

export const AI = {
  // ---------------------------------------------------------------- ANCIENT
  // Pierces EVERY enemy along the line of the shot.
  ballista(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    const tgt = first(g.near(tw.x, tw.z, s.range));
    if (!tgt) return;
    aim(tw, tgt.x, tgt.z, dt, 8);
    if (tw.cd > 0 || !aimed(tw, tgt.x, tgt.z, 0.2)) return;
    tw.cd = s.cd; tw.kick = 1;
    const m = muzzle(tw), c = center(tgt);
    const dx = c.x - m.x, dy = c.y - m.y, dz = c.z - m.z, len = Math.hypot(dx, dy, dz) || 1, reach = s.range + 8;
    const end = { x: m.x + dx / len * reach, y: m.y + dy / len * reach, z: m.z + dz / len * reach };
    for (const e of g.enemies) {
      if (e.alive && segDist(e.x, e.y + e.h * 0.5, e.z, m.x, m.y, m.z, end.x, end.y, end.z) <= 0.8 + e.def.size * 0.75) g.damage(e, s.dmg, 'pierce');
    }
    g.launch({ kind: 'bolt', from: m, to: end, dur: reach / 95 });
    g.sfx('shoot', tw.x, tw.z);
  },

  // Lobs boulders at the thickest clump. Blind spot up close.
  catapult(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    const arm = tw.mesh.userData.arm;
    if (tw.armT > 0 && arm) { // throw animation: fast forward swing, slow reset
      tw.armT = Math.max(0, tw.armT - dt * 1.7);
      const u = 1 - tw.armT;
      arm.rotation.x = -0.35 + 1.45 * (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8);
    }
    const list = g.near(tw.x, tw.z, s.range, s.minRange);
    if (!list.length) return;
    let tgt = null, best = -1;
    const cand = list.length > 24 ? list.slice(0, 24) : list, r2 = s.splash * s.splash;
    for (const e of cand) {
      let n = 0;
      for (const o of list) if ((o.x - e.x) ** 2 + (o.z - e.z) ** 2 < r2) n++;
      const score = n * 100 + e.d * 0.01;
      if (score > best) { best = score; tgt = e; }
    }
    aim(tw, tgt.x, tgt.z, dt, 5);
    if (tw.cd > 0 || !aimed(tw, tgt.x, tgt.z, 0.3)) return;
    tw.cd = s.cd; tw.armT = 1;
    const m = muzzle(tw), dist = Math.hypot(tgt.x - m.x, tgt.z - m.z), flight = Math.max(0.9, Math.min(1.9, dist / 17));
    const to = g.posAt(tgt.d + tgt.vNow * flight, tgt.lane);
    g.launch({
      kind: 'boulder', from: m, to, dur: flight, arc: 5 + dist * 0.2,
      land(p) {
        for (const e of g.enemies) {
          if (!e.alive) continue;
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (d < s.splash + e.def.size * 0.5) g.damage(e, s.dmg * (1 - 0.5 * Math.min(1, d / s.splash)), 'splash');
        }
        g.fx.burst(p.x, p.y + 0.6, p.z, 0x8a7a5a, 22, 7, 0.8, 0.9, 9, 3);
        g.fx.burst(p.x, p.y + 0.6, p.z, 0xffa040, 8, 5, 0.4, 0.6, 4, 2);
        g.fx.ring(p.x, p.y, p.z, 0xe0c080, s.splash, 0.45);
        g.fx.scorch('crater', p.x, p.z, s.splash * 0.55, 1);
        g.sfx('boom', p.x, p.z); g.shake(0.35, p.x, p.z);
      },
    });
    g.sfx('shoot', tw.x, tw.z);
  },

  // Sets enemies alight. Burning enemies spread the flames to their neighbours (see Game.updateEnemies).
  brazier(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    const list = g.near(tw.x, tw.z, s.range);
    if (!list.length || tw.cd > 0) return;
    let tgt = null, bd = 1e9; // prefer something that isn't burning yet, then the closest
    for (const e of list) { const d = e._dist + (e.burnUntil > g.t ? 100 : 0); if (d < bd) { bd = d; tgt = e; } }
    tw.cd = s.cd;
    g.launch({
      kind: 'fire', from: muzzle(tw), target: tgt, speed: 24,
      hit(e) { g.damage(e, s.dmg, 'fire'); g.ignite(e, s.burn, 3.2); g.fx.scorch('fire', e.x, e.z, 1.1, 0.8); },
    });
    g.sfx('shoot', tw.x, tw.z);
  },

  // Aura: every enemy in range is slowed; icy pulse for a little damage each second.
  totem(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    const list = g.near(tw.x, tw.z, s.range);
    for (const e of list) g.slow(e, 1 - s.slow, 0.3, 'frost');
    if (tw.cd > 0) return;
    tw.cd = s.cd;
    if (list.length) {
      for (const e of list) { g.damage(e, s.dmg, 'frost'); g.fx.burst(e.x, e.y + e.h * 0.6, e.z, 0x9fe4ff, 2, 2, 0.5, 0.35, 0, 0.5); }
      g.fx.ring(tw.x, tw.y, tw.z, 0x7fd8ff, s.range, 0.9, 0.06);
    } else if (tw.pulse++ % 3 === 0) g.fx.ring(tw.x, tw.y, tw.z, 0x7fd8ff, s.range * 0.5, 1.2, 0.05);
  },

  // Lightning that jumps from enemy to enemy.
  obelisk(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    if (tw.cd > 0) return;
    const list = g.near(tw.x, tw.z, s.range);
    if (!list.length) return;
    tw.cd = s.cd;
    const hit = [first(list)];
    for (let k = 1; k < s.chain; k++) {
      const cur = hit[hit.length - 1]; let best = null, bd = 81;
      for (const e of g.enemies) {
        if (!e.alive || hit.includes(e)) continue;
        const d2 = (e.x - cur.x) ** 2 + (e.z - cur.z) ** 2;
        if (d2 < bd) { bd = d2; best = e; }
      }
      if (!best) break;
      hit.push(best);
    }
    let prev = { x: tw.x, y: tw.y + 6.2, z: tw.z };
    g.fx.flash(prev.x, prev.y, prev.z, 0xcdbcff, 1.6, 0.2);
    hit.forEach((e, k) => {
      g.damage(e, s.dmg * Math.pow(0.88, k), 'chain');
      const c = center(e); g.fx.bolt(prev, c, 0xcdbcff, 0.2, 0.22, 1.3); g.fx.burst(c.x, c.y, c.z, 0xe4dcff, 4, 4, 0.3, 0.4, 0, 1);
      g.fx.scorch('bolt', e.x, e.z, 1.3, 0.9);
      prev = c;
    });
    g.sfx('zap', tw.x, tw.z);
  },

  // Roars: damages and stuns everything in range.
  sphinx(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    if (tw.roar > 0) { tw.roar -= dt; tw.head.scale.setScalar(1 + Math.sin(Math.max(0, tw.roar) * 20) * 0.04 * (tw.roar / 0.5)); } else if (tw.head.scale.x !== 1) tw.head.scale.setScalar(1);
    if (tw.cd > 0) return;
    const list = g.near(tw.x, tw.z, s.range);
    if (!list.length) return;
    tw.cd = s.cd; tw.roar = 0.5;
    for (const e of list) { g.damage(e, s.dmg, 'roar'); g.stun(e, s.stun * (e.type === 'boss' ? 0.4 : 1)); }
    g.fx.ring(tw.x, tw.y, tw.z, 0xe6c36a, s.range, 0.7, 0.12);
    g.fx.ring(tw.x, tw.y + 0.3, tw.z, 0xfff0b0, s.range * 0.7, 0.5, 0.1);
    g.fx.burst(tw.x, tw.y + 2.5, tw.z, 0xffe9a0, 24, 9, 0.6, 0.7, 0, 0.5);
    g.sfx('boom', tw.x, tw.z); g.shake(0.5, tw.x, tw.z);
  },

  // ---------------------------------------------------------------- FUTURISTIC
  // Continuous beam: damage per second ramps up the longer it stays on one target.
  laser(g, tw, dt) {
    const s = tw.s;
    if (tw.lock && (!tw.lock.alive || Math.hypot(tw.lock.x - tw.x, tw.lock.z - tw.z) > s.range + 1)) { tw.lock = null; tw.lockT = 0; }
    if (!tw.lock) { tw.lock = first(g.near(tw.x, tw.z, s.range)); tw.lockT = 0; }
    const e = tw.lock;
    if (!e) return;
    aim(tw, e.x, e.z, dt, 12);
    if (!aimed(tw, e.x, e.z, 0.35)) return;
    tw.lockT += dt;
    const heat = Math.min(1, tw.lockT / 7), dps = s.dmg + s.ramp * Math.min(tw.lockT, 7);
    g.damage(e, dps * dt, 'laser');
    const m = muzzle(tw), c = center(e);
    const col = heat > 0.66 ? 0xffffff : heat > 0.33 ? 0xff9a8a : 0xff4d4d;
    g.fx.beam(m, c, col, 0.1 + heat * 0.22, 0.06);
    g.fx.beam(m, c, 0xff2020, 0.35 + heat * 0.35, 0.06, 0.25);
    if (Math.random() < 0.6) g.fx.burst(c.x, c.y, c.z, 0xffb0a0, 1, 4, 0.25, 0.3, 4, 1);
    if (Math.random() < 0.05) g.fx.scorch('burn', e.x, e.z, 0.8, 0.6);
    tw.hum -= dt; if (tw.hum <= 0) { tw.hum = 0.45; g.sfx('zap', tw.x, tw.z, 0.4); }
  },

  // Hitscan sniper: always picks the toughest enemy in its enormous range.
  railgun(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    const list = g.near(tw.x, tw.z, s.range);
    if (!list.length) return;
    let tgt = list[0];
    for (const e of list) if (e.hp > tgt.hp) tgt = e;
    aim(tw, tgt.x, tgt.z, dt, 7);
    if (tw.cd > 0 || !aimed(tw, tgt.x, tgt.z, 0.08)) return;
    tw.cd = s.cd; tw.kick = 1.4;
    const m = muzzle(tw), c = center(tgt);
    g.damage(tgt, s.dmg, 'rail');
    g.fx.beam(m, c, 0xbfe0ff, 0.28, 0.4);
    g.fx.beam(m, c, 0x6fb7ff, 0.9, 0.3, 0.3);
    g.fx.flash(c.x, c.y, c.z, 0x9fd0ff, 2.6, 0.3);
    g.fx.ring(c.x, tgt.y, c.z, 0x6fb7ff, 3.5, 0.4, 0.15);
    g.fx.scorch('pit', c.x, c.z, 1.5, 1);
    g.fx.burst(c.x, c.y, c.z, 0xcfe8ff, 14, 8, 0.5, 0.5, 5, 1);
    g.sfx('boom', tw.x, tw.z, 0.7); g.shake(0.3, tw.x, tw.z);
  },

  // Rapid-fire arcs to several enemies at once.
  tesla(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    if (tw.cd > 0) return;
    const list = g.near(tw.x, tw.z, s.range);
    if (!list.length) return;
    tw.cd = s.cd;
    list.sort((a, b) => b.d - a.d);
    const top = { x: tw.x, y: tw.y + 4.6, z: tw.z };
    const n = Math.min(s.multi, list.length);
    for (let i = 0; i < n; i++) {
      const e = list[i], c = center(e);
      g.damage(e, s.dmg, 'tesla');
      g.fx.bolt(top, c, 0xa9f1ff, 0.13, 0.14, 0.8);
      if (Math.random() < 0.3) g.fx.scorch('bolt', e.x, e.z, 1.0, 0.7);
    }
    g.fx.flash(top.x, top.y, top.z, 0xa9f1ff, 1.3, 0.14);
    g.sfx('zap', tw.x, tw.z, 0.6);
  },

  // Drags enemies BACKWARD along the road and slows them.
  gravity(g, tw, dt) {
    const s = tw.s; tw.cd -= dt;
    const list = g.near(tw.x, tw.z, s.range);
    for (const e of list) { e.pull += s.pull * Math.min(1, 1.2 / e.def.size); e.pullX = tw.x; e.pullZ = tw.z; g.slow(e, 1 - s.slow, 0.3); }
    if (list.length && Math.random() < 0.5) g.fx.inflow(tw.x, tw.y, tw.z, s.range * 0.8, 0xc9a0ff, 1);
    if (tw.cd > 0) return;
    tw.cd = s.cd;
    if (list.length) {
      for (const e of list) g.damage(e, s.dmg, 'grav');
      g.fx.ring(tw.x, tw.y, tw.z, 0xa05cff, s.range, 0.8, 0.05);
    }
  },

  // Three orbiting drones, each picks its own target.
  hive(g, tw, dt) {
    const s = tw.s; tw.orbit += dt * 1.5;
    const list = g.near(tw.x, tw.z, s.range);
    if (list.length > 1) list.sort((a, b) => b.d - a.d);
    tw.drones.forEach((dr, i) => {
      const a = tw.orbit + i * (TAU / 3), tgt = list.length ? list[i % list.length] : null;
      const r = 2.7 + (tgt ? 0.6 : 0), y = 4.1 + Math.sin(g.t * 2.2 + i * 2) * 0.45;
      dr.obj.position.set(Math.cos(a) * r, y, Math.sin(a) * r); dr.obj.rotation.y += dt * 6;
      dr.cd -= dt;
      if (dr.cd <= 0 && tgt) {
        dr.cd = s.cd;
        const from = { x: tw.x + dr.obj.position.x, y: tw.y + y, z: tw.z + dr.obj.position.z }, c = center(tgt);
        g.damage(tgt, s.dmg, 'drone');
        g.fx.beam(from, c, 0x6dff8f, 0.09, 0.1); g.fx.burst(c.x, c.y, c.z, 0xbaffc9, 2, 3, 0.25, 0.3, 3, 0.5);
        if (Math.random() < 0.25) g.fx.scorch('burn', tgt.x, tgt.z, 0.7, 0.6);
        g.sfx('shoot', tw.x, tw.z, 0.35);
      }
    });
  },

  // Charges up, then detonates around itself. Waits fully charged if nothing is near.
  nova(g, tw, dt) {
    const s = tw.s;
    tw.charge = Math.min(s.cd, tw.charge + dt);
    const k = tw.charge / s.cd, core = tw.parts.core?.[0];
    if (core) { core.scale.setScalar(0.8 + k * 0.9 + Math.sin(g.t * (6 + k * 18)) * 0.05 * k); core.material.emissiveIntensity = 0.6 + k * 1.8; }
    if (k < 1) return;
    const list = g.near(tw.x, tw.z, s.range);
    if (!list.length) return;
    tw.charge = 0;
    for (const e of list) g.damage(e, s.dmg * (1 - 0.45 * Math.min(1, e._dist / s.range)), 'nova');
    const y = tw.y + 3;
    g.fx.flash(tw.x, y, tw.z, 0xff4de1, s.range * 0.85, 0.55, 0.55);
    g.fx.ring(tw.x, tw.y, tw.z, 0xff4de1, s.range, 0.7, 0.1);
    g.fx.ring(tw.x, tw.y + 0.4, tw.z, 0xffffff, s.range * 0.6, 0.5, 0.08);
    g.fx.scorch('blast', tw.x, tw.z, s.range * 0.42, 1);
    g.fx.burst(tw.x, y, tw.z, 0xff9af0, 40, 14, 0.9, 0.9, 2, 2);
    g.sfx('boom', tw.x, tw.z); g.shake(0.8, tw.x, tw.z);
  },
};
