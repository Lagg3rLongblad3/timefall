// In-game HUD: resources, wave info, base health, hotbar, context prompts, minimap and the duel panels.
// The DOM is built once per game; every frame only elements whose value changed are touched.
import { ENEMIES, SENDS, MAX_LEVEL } from './data.js';
import { HALF } from './world.js';

const el = (tag, cls, inner) => { const e = document.createElement(tag); if (cls) e.className = cls; if (inner !== undefined) e.innerHTML = inner; return e; };
const text = (e, v) => { if (e._v !== v) { e._v = v; e.textContent = v; } };
const html = (e, v) => { if (e._h !== v) { e._h = v; e.innerHTML = v; } };
const cls = (e, name, on) => { if (e._c?.[name] !== on) { (e._c ||= {})[name] = on; e.classList.toggle(name, on); } };
const hexCss = n => '#' + n.toString(16).padStart(6, '0');
const S = 176; // minimap size in CSS px

export class Hud {
  constructor(root) { this.root = root; this.mmT = 0; }

  start(game, icons) {
    const g = (this.g = game);
    this.icons = icons || { towers: {}, enemies: {} };
    const r = this.root; r.innerHTML = ''; r.classList.remove('hidden');

    this.vignette = el('div'); this.vignette.id = 'vignette';
    // --- top row
    const top = el('div', 'hud-top');
    const resBar = el('div', 'res-bar');
    this.res = g.resList.map(rs => {
      const e = el('div', 'res', `<i>${rs.icon}</i><span class="v">0</span><small>${rs.name}</small>`); e.style.setProperty('--rc', rs.color);
      resBar.append(e); return { e, v: e.querySelector('.v'), last: g.res[rs.id], t: 0 };
    });
    this.wave = el('div', 'wave-box', '<div class="t"></div><div class="s"></div><div class="bar"><i></i></div>');
    this.waveT = this.wave.children[0]; this.waveS = this.wave.children[1]; this.waveB = this.wave.querySelector('i');
    const baseBox = el('div', 'base-box');
    this.base = el('div', 'base', '<div class="l"><span>Base</span><b></b></div><div class="bar"><i></i></div>');
    this.baseN = this.base.querySelector('b'); this.baseB = this.base.querySelector('i');
    baseBox.append(this.base);
    if (g.pvp) {
      this.foe = el('div', 'base foe', '<div class="l"><span class="nm"></span><b></b></div><div class="bar"><i></i></div><div class="sub"></div>');
      this.foeNm = this.foe.querySelector('.nm'); this.foeN = this.foe.querySelector('b'); this.foeB = this.foe.querySelector('i'); this.foeS = this.foe.querySelector('.sub');
      baseBox.append(this.foe);
    }
    top.append(resBar, this.wave, baseBox);

    this.feedEl = el('div'); this.feedEl.id = 'feed';
    this.bannerEl = el('div', '', '<div class="b1"></div><div class="b2"></div>'); this.bannerEl.id = 'banner';
    this.cross = el('div'); this.cross.id = 'cross';
    this.prompt = el('div'); this.prompt.id = 'prompt';

    // --- hotbar (one slot per tower of this era)
    this.hotbar = el('div'); this.hotbar.id = 'hotbar';
    this.slots = g.defs.map((d, i) => {
      const img = this.icons.towers[d.id], e = el('div', 'slot');
      e.innerHTML = `<span class="k">${i + 1}</span>${img ? `<img src="${img}" alt="">` : `<div class="sw" style="--c:${hexCss(d.color)}"></div>`}<div class="n">${d.name}</div><div class="cost"></div>`;
      const cost = e.querySelector('.cost'), chips = Object.entries(d.cost).map(([k, v]) => {
        const rs = g.resList.find(x => x.id === k), c = el('span', 'chip', `${rs.icon}${v}`); cost.append(c); return { c, k, v };
      });
      this.hotbar.append(e); return { e, chips, d };
    });

    // --- minimap
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.mm = el('canvas'); this.mm.id = 'minimap'; this.mm.width = this.mm.height = S * dpr; this.mmCtx = this.mm.getContext('2d'); this.mmCtx.scale(dpr, dpr);
    this.mmStatic = this.drawStaticMap(dpr);

    r.append(this.vignette, top, this.feedEl, this.bannerEl, this.cross, this.prompt, this.hotbar, this.mm);

    // --- duel sabotage panel
    if (g.pvp) {
      this.sendBar = el('div', '', '<h4>Sabotage</h4>'); this.sendBar.id = 'sendbar';
      this.sends = SENDS.map(s => {
        const img = this.icons.enemies[s.type], e = el('div', 'send');
        e.innerHTML = `<span class="k">${s.key}</span>${img ? `<img src="${img}" alt="">` : ''}<div><div>${s.label} <span class="dim">×${s.n}</span></div><div class="cost"></div></div>`;
        const cost = e.querySelector('.cost'), chips = s.cost.map((v, i) => { if (!v) return null; const rs = g.resList[i], c = el('span', 'chip', `${rs.icon}${v}`); cost.append(c); return { c, id: rs.id, v }; }).filter(Boolean);
        this.sendBar.append(e); return { e, chips, s };
      });
      r.append(this.sendBar);
    }
  }

  stop() { this.root.classList.add('hidden'); this.root.innerHTML = ''; this.g = null; }

  // ---------------------------------------------------------------- events from the game
  banner(title, sub = '') {
    this.bannerEl.children[0].textContent = title; this.bannerEl.children[1].textContent = sub;
    this.bannerEl.classList.remove('show'); void this.bannerEl.offsetWidth; this.bannerEl.classList.add('show');
  }
  feed(msg) {
    const d = el('div'); d.textContent = msg; this.feedEl.append(d);
    while (this.feedEl.children.length > 5) this.feedEl.firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  }
  hit() { this.vignette.classList.add('hit'); setTimeout(() => this.vignette.classList.remove('hit'), 70); }

  // ---------------------------------------------------------------- per-frame
  chips(cost, g, plain = false) { // plain: never flag a shortfall (used for refunds)
    return Object.entries(cost).map(([k, v]) => { const rs = g.resList.find(x => x.id === k); return `<span class="chip ${plain || g.res[k] >= v ? '' : 'no'}">${rs.icon} ${v}</span>`; }).join(' ');
  }

  update(dt) {
    const g = this.g; if (!g) return;
    // resources
    g.resList.forEach((rs, i) => {
      const o = this.res[i], v = Math.floor(g.res[rs.id]);
      text(o.v, String(v));
      if (v > o.last) { o.t = 0.35; cls(o.e, 'gain', true); }
      o.last = v; if (o.t > 0) { o.t -= dt; if (o.t <= 0) cls(o.e, 'gain', false); }
    });
    // wave
    const alive = g.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0) + g.queue.length, fin = isFinite(g.nextWaveIn);
    const gap = g.timing.gap, prep = g.timing.prep;
    if (g.wave === 0) { text(this.waveT, 'PREPARE'); html(this.waveS, `First wave in ${Math.ceil(g.nextWaveIn)}s${g.pvp ? '' : ' &middot; <kbd>N</kbd> call it now'}`); }
    else {
      text(this.waveT, g.pvp ? `WAVE ${g.wave}` : `WAVE ${g.wave} / ${g.waveTotal}`);
      html(this.waveS, fin ? `Next wave in ${Math.ceil(g.nextWaveIn)}s${g.pvp ? '' : ' &middot; <kbd>N</kbd> call early'} &middot; 👾 ${alive}` : `Final wave &middot; 👾 ${alive} left`);
    }
    this.waveB.style.width = (fin ? Math.max(0, Math.min(1, 1 - g.nextWaveIn / (g.wave === 0 ? prep : gap))) * 100 : 100) + '%';
    // base
    const f = g.baseHp / g.baseMax; text(this.baseN, `${Math.ceil(g.baseHp)} / ${g.baseMax}`);
    this.baseB.style.width = f * 100 + '%'; this.baseB.style.background = `hsl(${Math.round(f * 120)}, 78%, 56%)`;
    if (g.pvp) {
      const o = g.opp, of = Math.max(0, o.hp / o.max);
      text(this.foeNm, o.name); text(this.foeN, `${Math.ceil(o.hp)} / ${o.max}`); this.foeB.style.width = of * 100 + '%'; this.foeB.style.background = `hsl(${Math.round(of * 120)}, 78%, 56%)`;
      text(this.foeS, `Wave ${o.wave} · ${o.towers} towers · ${o.kills} kills`);
      this.sends.forEach(({ e, chips, s }) => {
        const ok = g.canAfford(g.tierCost(s.cost)) && g.sendCd <= 0;
        cls(e, 'ok', ok); cls(e, 'cd', !ok);
        chips.forEach(c => cls(c.c, 'no', g.res[c.id] < c.v));
      });
      text(this.sendBar.firstChild, g.sendCd > 0 ? `Sabotage · ${Math.ceil(g.sendCd)}s` : 'Sabotage');
    }
    // hotbar
    this.slots.forEach(({ e, chips, d }, i) => {
      cls(e, 'on', g.buildIdx === i); cls(e, 'poor', !g.canAfford(d.cost));
      chips.forEach(c => cls(c.c, 'no', g.res[c.k] < c.v));
    });
    // crosshair + prompt
    const kind = g.buildIdx >= 0 ? (g.ghostInfo.ok ? 'good' : 'bad') : g.aim?.kind || '';
    cls(this.cross, 'node', kind === 'node'); cls(this.cross, 'tower', kind === 'tower'); cls(this.cross, 'bad', kind === 'bad');
    const p = this.promptHTML(g); html(this.prompt, p); this.prompt.style.display = p ? '' : 'none';
    // minimap (10 fps is plenty)
    this.mmT -= dt; if (this.mmT <= 0) { this.mmT = 0.1; this.drawMap(g); }
  }

  promptHTML(g) {
    if (g.state !== 'playing') return '';
    if (g.buildIdx >= 0) {
      const d = g.defs[g.buildIdx], gi = g.ghostInfo;
      return `<b>${d.name}</b> &mdash; ${gi.reason ? `<span class="bad">${gi.reason}</span>` : '<span class="good">Ready to build</span>'}`
        + `<div class="stats"><span>DMG ${d.dmg}</span><span>RANGE ${d.range}</span>${d.minRange ? `<span>MIN ${d.minRange}</span>` : ''}</div><div class="dim"><kbd>LMB</kbd> place &nbsp; <kbd>RMB</kbd> / <kbd>Q</kbd> cancel</div>`;
    }
    const a = g.aim;
    if (a?.kind === 'node') {
      const n = a.ref, rs = g.resList[n.type];
      return `Hold <kbd>LMB</kbd> to gather <b style="color:${rs.color}">${rs.name}</b> <span class="dim">&middot; ${n.hits}/${n.max} hits left &middot; +${n.yield} each</span>`;
    }
    if (a?.kind === 'tower') {
      const tw = a.ref, s = tw.s, up = tw.level < MAX_LEVEL;
      const rate = s.cd ? `${(1 / s.cd).toFixed(1)}/s` : 'beam';
      return `<b>${tw.def.name}</b> <span class="dim">Lv ${tw.level}/${MAX_LEVEL}</span><div class="stats"><span>DMG ${Math.round(s.dmg)}</span><span>RANGE ${Math.round(s.range)}</span><span>RATE ${rate}</span></div>`
        + `<div class="dim">${tw.def.desc}</div>`
        + `<div>${up ? `<kbd>F</kbd> upgrade ${this.chips(g.upgradeCost(tw), g)}` : '<span class="good">MAX LEVEL</span>'} &nbsp; <kbd>R</kbd> sell ${this.chips(g.refund(tw), g, true)}</div>`;
    }
    if (g.t < 45) return `<span class="dim">Hold <kbd>LMB</kbd> near trees, rocks &amp; ore to gather &nbsp;&middot;&nbsp; <kbd>1</kbd>&ndash;<kbd>6</kbd> build</span>`;
    return '';
  }

  // ---------------------------------------------------------------- minimap
  mx(x) { return (x + HALF) / (2 * HALF) * S; }
  drawStaticMap(dpr) {
    const g = this.g, th = g.map.theme, c = el('canvas'); c.width = c.height = S * dpr; const x = c.getContext('2d'); x.scale(dpr, dpr);
    const hex = n => '#' + n.toString(16).padStart(6, '0');
    const grad = x.createLinearGradient(0, 0, S, S); grad.addColorStop(0, hex(th.g1)); grad.addColorStop(1, hex(th.g2)); x.fillStyle = grad; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(0, 0, S, S);
    if (g.era === 'futuristic') { x.strokeStyle = 'rgba(77,227,255,.12)'; x.lineWidth = 1; for (let i = 0; i <= 18; i++) { const p = i * S / 18; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, S); x.moveTo(0, p); x.lineTo(S, p); x.stroke(); } }
    const wt = g.world.water;
    if (wt) { x.fillStyle = wt.css; x.globalAlpha = 0.8; for (let z = -HALF; z <= HALF; z++) for (let xx = -HALF; xx <= HALF; xx++) if (g.world.heightAt(xx, z) < wt.level) x.fillRect(this.mx(xx) - 0.6, this.mx(z) - 0.6, 1.3, 1.3); x.globalAlpha = 1; }
    x.lineJoin = x.lineCap = 'round';
    const path = () => { x.beginPath(); g.world.pts.forEach((p, i) => (i ? x.lineTo(this.mx(p.x), this.mx(p.z)) : x.moveTo(this.mx(p.x), this.mx(p.z)))); };
    path(); x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 7; x.stroke();
    path(); x.strokeStyle = hex(th.path); x.lineWidth = 4.5; x.stroke();
    path(); x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 1; x.stroke();
    const s = g.world.spawnPos, b = g.world.basePos;
    x.fillStyle = '#ff4d4d'; x.beginPath(); x.arc(this.mx(s.x), this.mx(s.z), 5, 0, 6.3); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = '#4de3ff'; x.fillRect(this.mx(b.x) - 5, this.mx(b.z) - 5, 10, 10); x.strokeRect(this.mx(b.x) - 5, this.mx(b.z) - 5, 10, 10);
    return c;
  }
  drawMap(g) {
    const x = this.mmCtx;
    x.clearRect(0, 0, S, S); x.drawImage(this.mmStatic, 0, 0, S, S);
    for (const n of g.world.nodes) {
      if (!n.seen) continue;
      x.fillStyle = g.resList[n.type].color; x.globalAlpha = n.hits > 0 ? 1 : 0.28;
      x.beginPath(); x.arc(this.mx(n.x), this.mx(n.z), n.type === 3 ? 3 : 2.3, 0, 6.3); x.fill();
    }
    x.globalAlpha = 1;
    for (const t of g.towers) { x.fillStyle = hexCss(t.def.color); x.fillRect(this.mx(t.x) - 3, this.mx(t.z) - 3, 6, 6); x.strokeStyle = '#fff'; x.lineWidth = 1; x.strokeRect(this.mx(t.x) - 3, this.mx(t.z) - 3, 6, 6); }
    for (const e of g.enemies) { if (!e.alive) continue; x.fillStyle = e.type === 'boss' ? '#ff00aa' : '#ff4040'; x.beginPath(); x.arc(this.mx(e.x), this.mx(e.z), e.type === 'boss' ? 4 : e.def.size > 1 ? 2.8 : 1.8, 0, 6.3); x.fill(); }
    // you: arrow plus a faint view cone
    const p = g.player, px = this.mx(p.x), pz = this.mx(p.z), a = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));
    x.fillStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.moveTo(px, pz); x.arc(px, pz, 26, a - 0.62, a + 0.62); x.closePath(); x.fill();
    x.save(); x.translate(px, pz); x.rotate(a); x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(6, 0); x.lineTo(-4, -4); x.lineTo(-2, 0); x.lineTo(-4, 4); x.closePath(); x.fill(); x.stroke(); x.restore();
  }
}
