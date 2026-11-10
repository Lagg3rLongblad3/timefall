// TIMEFALL bootstrap: renderer, animated menu backdrop, menu UI, lobby (friends / challenges / quick match), game lifecycle.
import * as THREE from 'three';
import { Music } from './audio.js';
import { Net } from './net.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { buildWorld, makePath } from './world.js';
import { disposeTree } from './fx.js';
import { GFX, QUALITY, QUALITY_ORDER, setQuality, detectQuality } from './gfx.js';
import { Post } from './post.js';
import { makeIcons } from './icons.js';
import { getMap, DIFFS, DIFF_KEYS, RES, TOWERS, ERAS, mulberry } from './data.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = n => '#' + n.toString(16).padStart(6, '0');
const DEBUG = /[?&]debug\b/.test(location.search);   // ?debug: input works without pointer lock (automated tests)
const PROBE = DEBUG || /[?&]probe\b/.test(location.search); // ?probe: just expose window.__tf for inspection
const store = {
  get(k, d) { try { const v = localStorage.getItem('timefall.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('timefall.' + k, JSON.stringify(v)); } catch {} },
};

// ------------------------------------------------------------------ state
const S = {
  era: store.get('era', 'ancient'), diff: store.get('diff', 'easy'), map: store.get('map', 0), name: store.get('name', ''),
  clear: store.get('clear', {}), muted: store.get('muted', false),
  game: null, frames: 0, loading: false, queued: false, friends: [], requests: [], backdrop: null, lastStart: null, icons: { towers: {}, enemies: {} }, errShown: false,
};
if (!ERAS[S.era]) S.era = 'ancient';
if (!DIFFS[S.diff]) S.diff = 'easy';
if (!(S.map >= 0 && S.map < 6)) S.map = 0;

// ------------------------------------------------------------------ renderer
const canvas = $('#gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.body.insertAdjacentHTML('beforeend', '<div id="overlay"><div class="card"><h1 class="bad">NO WEBGL</h1><p>TIMEFALL needs WebGL to draw its 3D world. Try a current version of Chrome, Edge or Firefox with hardware acceleration enabled.</p></div></div>');
  throw e;
}
S.gfx = setQuality(store.get('gfx', null) || detectQuality(renderer.getContext()));
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GFX.pixelRatio));
renderer.shadowMap.enabled = GFX.shadows; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
GFX.renderer = renderer;
renderer.setSize(innerWidth, innerHeight);
const post = new Post(renderer);
post.enabled = GFX.usePost; post.samples = Math.min(GFX.samples, renderer.capabilities.maxSamples || 0); post.levels = GFX.bloomLevels || 5;
const resizePost = () => { const v = renderer.getDrawingBufferSize(new THREE.Vector2()); post.setSize(v.x, v.y); };
resizePost();
GFX.post = post;
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); resizePost();
  if (S.backdrop) { S.backdrop.cam.aspect = innerWidth / innerHeight; S.backdrop.cam.updateProjectionMatrix(); }
  S.game?.resize(innerWidth, innerHeight, renderer.getPixelRatio());
});

const music = new Music(); music.muted = S.muted; music.setEra(S.era);
const net = new Net();
const hud = new Hud($('#hud'));
const unlockAudio = () => { music.start(); removeEventListener('pointerdown', unlockAudio); removeEventListener('keydown', unlockAudio); };
addEventListener('pointerdown', unlockAudio); addEventListener('keydown', unlockAudio);

// ------------------------------------------------------------------ small UI helpers
function toast(msg, kind = '') {
  const box = $('#toasts'), t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg; box.append(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => t.remove(), 3700);
}
function showCard(inner) { $('#card').innerHTML = inner; $('#overlay').classList.remove('hidden'); return $('#card'); }
function hideCard() { $('#overlay').classList.add('hidden'); $('#card').innerHTML = ''; }
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ menu backdrop (the selected map, slowly orbited)
function setBackdrop() {
  if (S.backdrop) disposeTree(S.backdrop.world.scene);
  const world = buildWorld(getMap(S.era, S.diff, S.map));
  world.focus(new THREE.Vector3(0, 0, 0), 105); // static sun: one wide shadow frame for the whole map
  const cam = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 1, 1200);
  S.backdrop = { world, cam, t: Math.random() * 20, key: `${S.era}:${S.diff}:${S.map}` };
}
function updateBackdrop(dt) {
  const b = S.backdrop; b.t += dt;
  const a = b.t * 0.045, r = 122;
  b.cam.position.set(Math.cos(a) * r, 48 + Math.sin(b.t * 0.2) * 5, Math.sin(a) * r);
  b.cam.lookAt(0, 6, 0); b.world.animate(b.t, b.cam.position);
}

// ------------------------------------------------------------------ menu rendering
function renderEra() {
  document.documentElement.dataset.era = S.era;
  $('#tagline').textContent = ERAS[S.era].tag;
  $$('#era-toggle button').forEach(b => b.classList.toggle('on', b.dataset.era === S.era));
}
function renderDiff() {
  $('#diff-tabs').innerHTML = DIFF_KEYS.map(k => `<button data-diff="${k}" class="${k === S.diff ? 'on' : ''}">${DIFFS[k].label}</button>`).join('');
  const c = DIFFS[S.diff], r = RES[S.era];
  $('#diff-info').innerHTML = `<b>${c.waves}</b> waves &nbsp;·&nbsp; base <b>${c.base}</b> HP &nbsp;·&nbsp; enemies <b>${Math.round(c.hp * 100)}%</b> health &nbsp;·&nbsp; start with <b>${c.start}</b> ${r[0].name} &amp; ${r[1].name}${c.rare ? `, ${c.rare} ${r[2].name}` : ''}`;
}
function drawThumb(cv, map) {
  const W = (cv.width = 260), H = (cv.height = 130), x = cv.getContext('2d'), th = map.theme;
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, hex(th.g1)); g.addColorStop(1, hex(th.g2)); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const rng = mulberry(map.seed);
  for (let i = 0; i < 16; i++) { x.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.10)'; x.beginPath(); x.ellipse(rng() * W, rng() * H, 18 + rng() * 44, 10 + rng() * 26, rng() * 3, 0, 6.3); x.fill(); }
  if (map.era === 'futuristic') { x.strokeStyle = 'rgba(77,227,255,.14)'; for (let i = 1; i < 14; i++) { x.beginPath(); x.moveTo(i * W / 14, 0); x.lineTo(i * W / 14, H); x.moveTo(0, i * H / 14); x.lineTo(W, i * H / 14); x.stroke(); } }
  const { pts, pathLen } = makePath(map), px = p => (p.x + 90) / 180 * W, pz = p => (p.z + 90) / 180 * H;
  const trace = () => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(px(p), pz(p)) : x.moveTo(px(p), pz(p)))); };
  x.lineJoin = x.lineCap = 'round';
  trace(); x.strokeStyle = 'rgba(0,0,0,.5)'; x.lineWidth = 9; x.stroke();
  trace(); x.strokeStyle = hex(th.path); x.lineWidth = 6; x.stroke();
  trace(); x.strokeStyle = 'rgba(255,255,255,.28)'; x.lineWidth = 1.2; x.stroke();
  const s = pts[0], b = pts[pts.length - 1];
  x.fillStyle = '#ff4d4d'; x.beginPath(); x.arc(px(s), pz(s), 7, 0, 6.3); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke();
  x.fillStyle = '#4de3ff'; x.fillRect(px(b) - 7, pz(b) - 7, 14, 14); x.strokeRect(px(b) - 7, pz(b) - 7, 14, 14);
  return Math.round(pathLen);
}
function renderMaps() {
  const grid = $('#map-grid'); grid.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const map = getMap(S.era, S.diff, i), card = document.createElement('button');
    card.className = 'map-card' + (i === S.map ? ' on' : ''); card.dataset.idx = i;
    card.innerHTML = `<canvas></canvas><div class="meta"><span>${esc(map.name)}</span><small></small></div>`;
    card.querySelector('small').textContent = drawThumb(card.querySelector('canvas'), map) + ' m road';
    if (S.clear[`${S.era}:${S.diff}:${i}`]) card.insertAdjacentHTML('beforeend', '<span class="badge">✔ CLEARED</span>');
    grid.append(card);
  }
  $('#start').textContent = `▶ Start — ${getMap(S.era, S.diff, S.map).name}`;
}
function renderArsenal() {
  $('#arsenal-sub').textContent = `${ERAS[S.era].label} · hover a tower in game to read it`;
  $('#arsenal').innerHTML = TOWERS[S.era].map(t => {
    const img = S.icons.towers[t.id], cost = Object.entries(t.cost).map(([k, v]) => `${RES[S.era].find(r => r.id === k).icon}${v}`).join(' ');
    return `<div class="tower-card">${img ? `<img src="${img}" alt="">` : `<div class="sw" style="--c:${hex(t.color)}"></div>`}<div><b>${esc(t.name)}</b><span>${esc(t.desc)}</span><span>${cost}</span></div></div>`;
  }).join('');
}
function renderWho() {
  $('#who-name').textContent = S.name || 'Pick a name';
  $('#who').classList.toggle('online', net.online);
}
function renderOnline() {
  const pill = $('#net-pill'); pill.textContent = net.status; pill.className = 'pill ' + net.status;
  const q = $('#quick');
  q.disabled = !net.online || S.loading;
  q.textContent = S.queued ? '⏳ Searching… (click to cancel)' : '⚡ Quick Match'; q.classList.toggle('on', S.queued);
  renderWho(); renderFriends();
}
function renderFriends() {
  $('#requests').innerHTML = S.requests.map(n => `<div class="request"><span class="nm">${esc(n)} <small class="dim">wants to be friends</small></span><button class="btn" data-act="accept" data-name="${esc(n)}" title="Accept">✓</button><button class="btn danger" data-act="decline" data-name="${esc(n)}" title="Decline">✕</button></div>`).join('');
  const f = $('#friends');
  if (!net.online) { f.innerHTML = '<div class="empty">Sign in to see your friends.</div>'; return; }
  if (!S.friends.length) { f.innerHTML = '<div class="empty">No friends yet. Add someone by name, then challenge them to a duel.</div>'; return; }
  const list = [...S.friends].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  f.innerHTML = list.map(fr => {
    const st = fr.online ? (fr.busy ? 'busy' : 'online') : '', label = fr.online ? (fr.busy ? 'in a match' : 'online') : 'offline';
    return `<div class="friend"><span class="st ${st}"></span><span class="nm">${esc(fr.name)} <small>${label}</small></span><button class="btn" data-act="challenge" data-name="${esc(fr.name)}" ${fr.online && !fr.busy ? '' : 'disabled'}>⚔ Challenge</button><button class="btn danger" data-act="remove" data-name="${esc(fr.name)}" title="Remove friend">✕</button></div>`;
  }).join('');
}
function renderAll() { $('#gfx').textContent = { low: 'LOW', medium: 'MED', high: 'HIGH' }[S.gfx]; $('#gfx').title = `Graphics quality: ${S.gfx} (click to change)`; renderEra(); renderDiff(); renderMaps(); renderArsenal(); renderOnline(); $('#mute').textContent = S.muted ? '🔇' : '🔊'; }

function loadIcons() { // 3D icon snapshots, rendered after the first frame so the menu appears instantly
  setTimeout(() => { S.icons = makeIcons(S.era); renderArsenal(); }, 30);
}

// ------------------------------------------------------------------ menu actions
function setEra(era) {
  if (era === S.era) return;
  S.era = era; store.set('era', era); music.setEra(era); music.sfx('click');
  renderAll(); setBackdrop(); loadIcons();
}
function selectMap(i) {
  S.map = i; store.set('map', i); music.sfx('click');
  $$('.map-card').forEach(c => c.classList.toggle('on', +c.dataset.idx === i));
  $('#start').textContent = `▶ Start — ${getMap(S.era, S.diff, i).name}`;
  setBackdrop();
}
$('#era-toggle').addEventListener('click', e => { const b = e.target.closest('button[data-era]'); if (b) setEra(b.dataset.era); });
$('#diff-tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-diff]'); if (!b || b.dataset.diff === S.diff) return;
  S.diff = b.dataset.diff; store.set('diff', S.diff); music.sfx('click'); renderDiff(); renderMaps(); setBackdrop();
});
$('#map-grid').addEventListener('click', e => { const c = e.target.closest('.map-card'); if (c) selectMap(+c.dataset.idx); });
$('#map-grid').addEventListener('dblclick', e => { if (e.target.closest('.map-card')) startSolo(); });
$('#start').addEventListener('click', () => startSolo());
function applyQuality(name) { // takes effect on the next world build (the menu backdrop is rebuilt right away)
  S.gfx = setQuality(name); store.set('gfx', S.gfx);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GFX.pixelRatio)); renderer.setSize(innerWidth, innerHeight); resizePost();
  renderer.shadowMap.enabled = GFX.shadows; renderer.shadowMap.needsUpdate = true;
  post.enabled = GFX.usePost; post.samples = Math.min(GFX.samples, renderer.capabilities.maxSamples || 0); post.levels = GFX.bloomLevels || 5; post.rebuild?.();
  $('#gfx').textContent = { low: 'LOW', medium: 'MED', high: 'HIGH' }[S.gfx]; $('#gfx').title = `Graphics quality: ${S.gfx} (click to change)`;
  if (!S.game) setBackdrop();
}
$('#gfx').addEventListener('click', () => applyQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(S.gfx) + 1) % QUALITY_ORDER.length]));
$('#mute').addEventListener('click', () => { S.muted = !S.muted; store.set('muted', S.muted); music.setMuted(S.muted); $('#mute').textContent = S.muted ? '🔇' : '🔊'; music.start(); });
$('#who').addEventListener('click', () => askName(false));
$('#quick').addEventListener('click', () => {
  if (!net.online) return;
  if (S.queued) { net.send({ type: 'quick', on: false }); S.queued = false; renderOnline(); return; }
  net.send({ type: 'quick', on: true, era: S.era }); music.sfx('click');
});
$('#friend-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#friend-input'), name = input.value.replace(/[^\w \-]/g, '').trim().slice(0, 16);
  if (!name) return;
  if (!net.online) return toast('Sign in first to add friends.', 'warn');
  net.send({ type: 'addFriend', name }); input.value = '';
});
$('#menu').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const name = b.dataset.name;
  switch (b.dataset.act) {
    case 'challenge': net.send({ type: 'challenge', name, era: S.era, map: Math.floor(Math.random() * 6) }); break;
    case 'remove': net.send({ type: 'removeFriend', name }); break;
    case 'accept': net.send({ type: 'acceptFriend', name, accept: true }); break;
    case 'decline': net.send({ type: 'acceptFriend', name, accept: false }); break;
  }
});

// ------------------------------------------------------------------ identity
function askName(first, error = '') {
  const card = showCard(`<h1>TIMEFALL</h1><p>${first ? 'Welcome, Commander. Choose the name your rivals and friends will see.' : 'Change your display name.'}</p>
    <input id="name-input" maxlength="16" placeholder="Display name" value="${esc(S.name)}" autocomplete="off" spellcheck="false">
    <div class="err">${esc(error)}</div>
    <div class="row"><button class="cta" id="name-ok">${first ? 'Continue' : 'Save'}</button>${first ? '' : '<button class="btn" id="name-cancel">Cancel</button>'}</div>`);
  const input = card.querySelector('#name-input'); input.focus(); input.select();
  const submit = async () => {
    const name = input.value.replace(/[^\w \-]/g, '').trim().slice(0, 16);
    if (!name) { input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake'); card.querySelector('.err').textContent = 'Use letters, numbers, spaces, - or _.'; return; }
    hideCard(); music.sfx('click');
    await signIn(name);
  };
  card.querySelector('#name-ok').onclick = submit;
  input.onkeydown = e => { if (e.key === 'Enter') submit(); };
  const cancel = card.querySelector('#name-cancel'); if (cancel) cancel.onclick = hideCard;
}
async function signIn(name) {
  S.name = name; store.set('name', name); renderWho();
  try { await net.connect(name); toast(`Signed in as ${net.name}`, 'good'); }
  catch (err) {
    if (err.fatal) { S.name = ''; renderWho(); askName(!store.get('name', ''), err.message); }
    else toast('Offline: solo play only. Retrying in the background…', 'warn');
  }
}

// ------------------------------------------------------------------ network events
net.on('status', () => {
  if (net.status !== 'online') S.queued = false;
  if (net.status === 'offline' && S.game?.pvp && S.game.state === 'playing') S.game.finish(false, 'offline');
  renderOnline();
});
const syncFriends = m => { S.friends = m.friends || []; S.requests = m.requests || []; renderFriends(); };
net.on('welcome', syncFriends); net.on('friends', syncFriends);
net.on('info', m => toast(m.msg));
net.on('error', m => { if (net.status === 'online') toast(m.msg, 'warn'); });
net.on('queued', () => { S.queued = true; renderOnline(); });
net.on('matchStart', m => {
  S.queued = false;
  if (S.loading) { net.send({ type: 'leaveMatch' }); return toast('A match was found while you were loading, so it was cancelled.', 'warn'); } // free the rival instead of leaving them waiting
  if (S.game) leaveGame();
  if (!ERAS[m.era]) return;
  if (m.era !== S.era) { S.era = m.era; store.set('era', m.era); renderAll(); }
  startGame({ mode: 'pvp', era: m.era, mapIdx: m.map | 0, seed: m.seed | 0, opponent: m.opponent, side: m.side });
});
net.on('matchEnd', m => S.game?.onMatchEnd(m.reason));
net.on('relay', m => S.game?.onRelay(m.data));
net.on('challenge', m => {
  if (S.game || S.loading || !ERAS[m.era]) { net.send({ type: 'challengeReply', from: m.from, accept: false }); return toast(`Declined ${m.from}'s challenge: you are busy.`); }
  music.sfx('wave');
  const card = showCard(`<h1>DUEL</h1><p><b>${esc(m.from)}</b> challenges you to an <b>${ERAS[m.era].label}</b> duel!</p><p class="small">Same map, same waves. Send enemies at your rival and outlast them.</p>
    <div class="row"><button class="cta" id="ch-yes">Accept</button><button class="btn" id="ch-no">Decline</button></div>`);
  card.querySelector('#ch-yes').onclick = () => { hideCard(); net.send({ type: 'challengeReply', from: m.from, accept: true }); };
  card.querySelector('#ch-no').onclick = () => { hideCard(); net.send({ type: 'challengeReply', from: m.from, accept: false }); };
});

// ------------------------------------------------------------------ game lifecycle
const gameUI = {
  toast, banner: (a, b) => hud.banner(a, b), feed: m => hud.feed(m), hit: () => hud.hit(),
  end: r => showResult(r), draw: () => S.lastResult && showResult({ ...S.lastResult, draw: true }),
};

function startSolo() { startGame({ mode: 'solo', era: S.era, diff: S.diff, mapIdx: S.map }); }

async function startGame(opts) {
  if (S.loading || S.game) return;
  // Grab the mouse NOW, while the click that started the game still counts as a user gesture: building the world can take longer
  // than the browser's activation window on a slow machine, and a late request is refused.
  const lock = () => { if (!DEBUG) try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} };
  lock();
  S.loading = true; S.lastStart = opts; renderOnline();
  if (S.queued) { net.send({ type: 'quick', on: false }); S.queued = false; }
  hideCard(); $('#loading').classList.remove('hidden');
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))); // let the loading screen paint before the heavy world build
  try {
    music.start(); music.setEra(opts.era); renderEraTheme(opts.era);
    const g = new Game({ ...opts, canvas, ui: gameUI, music, net, aspect: innerWidth / innerHeight, width: innerWidth, height: innerHeight, dpr: renderer.getPixelRatio(), alwaysActive: DEBUG });
    try { draw(g.scene, g.camera, g.world.look, 0, 0, g.fx); g.warm(() => { renderer.setRenderTarget(post.enabled ? post.rt : null); renderer.compile(g.scene, g.camera); renderer.setRenderTarget(null); }); } catch {} // compile every shader now, behind the loading screen, instead of stuttering on the first frames
    if (S.backdrop) { disposeTree(S.backdrop.world.scene); S.backdrop = null; }
    S.game = g; S.lastResult = null;
    hud.start(g, makeIcons(opts.era));
    $('#menu').classList.add('hidden'); document.body.classList.add('ingame');
    if (!DEBUG) {
      lock();
      setTimeout(() => { if (S.game === g && g.state === 'playing' && document.pointerLockElement !== canvas) { g.setPaused(true); showPause(); } }, 400);
    }
  } catch (e) {
    console.error(e); toast('Could not start the game: ' + e.message, 'warn');
    try { document.exitPointerLock?.(); } catch {}
    S.game = null; renderEra(); setBackdrop();
  } finally {
    S.loading = false; $('#loading').classList.add('hidden'); renderOnline();
  }
}
function renderEraTheme(era) { document.documentElement.dataset.era = era; }

function leaveGame() {
  const g = S.game; if (!g) return;
  if (g.pvp && g.state === 'playing') net.send({ type: 'leaveMatch' }); // walking out of a duel is a forfeit
  S.game = null; g.dispose(); hud.stop(); hideCard();
  try { document.exitPointerLock?.(); } catch {}
  music.intensity = 0.4; music.setEra(S.era); renderAll(); setBackdrop();
  $('#menu').classList.remove('hidden'); document.body.classList.remove('ingame');
}

function showPause() {
  const g = S.game; if (!g || g.state !== 'playing') return;
  const card = showCard(`<h1>${g.pvp ? 'DUEL IN PROGRESS' : 'PAUSED'}</h1>
    <p>${g.pvp ? 'The match keeps running while you are away.' : 'The battlefield is frozen.'} Click Resume to take control again.</p>
    <div class="controls"><span>W A S D</span><span>move &nbsp;·&nbsp; Shift sprint &nbsp;·&nbsp; Space jump</span><span>Hold LMB</span><span>gather from trees, rocks and ore</span><span>1 – 6</span><span>pick a tower, LMB to place, RMB / Q to cancel</span><span>F / R</span><span>upgrade / sell the tower you look at</span>${g.pvp ? '<span>Z X C V</span><span>send enemies at your rival</span>' : '<span>N</span><span>call the next wave early for a bonus</span>'}</div>
    <div class="row"><button class="cta" id="resume">Resume</button><button class="btn danger" id="quit">${g.pvp ? 'Forfeit' : 'Quit to menu'}</button></div>`);
  card.querySelector('#resume').onclick = () => canvas.requestPointerLock?.();
  card.querySelector('#quit').onclick = () => leaveGame();
}
document.addEventListener('pointerlockchange', () => {
  const g = S.game; if (!g || g.state !== 'playing') return;
  const locked = document.pointerLockElement === canvas;
  g.setPaused(!locked);
  if (locked) hideCard(); else showPause();
});

function showResult(r) {
  S.lastResult = r;
  if (r.won && r.mode === 'solo') { S.clear[`${S.lastStart.era}:${S.lastStart.diff}:${S.lastStart.mapIdx}`] = true; store.set('clear', S.clear); }
  const why = {
    cleared: 'Every wave repelled. The timeline holds.', 'base-fell': 'Your base has fallen.', 'rival-fell': `${r.opponent}'s base fell first.`,
    'rival-left': `${r.opponent} left the match.`, offline: 'The connection to the server was lost.',
  }[r.reason] || '';
  const title = r.draw ? 'DRAW' : r.won ? 'VICTORY' : r.reason === 'offline' ? 'DISCONNECTED' : 'DEFEAT';
  const st = r.stats, waves = r.waves === Infinity ? `${r.wave}` : `${r.wave} / ${r.waves}`;
  const card = showCard(`<h1 class="${r.won && !r.draw ? '' : 'bad'}">${title}</h1><p>${r.draw ? 'Both bases fell at the same moment.' : esc(why)}</p>
    <div class="grid"><div><b>${waves}</b><span>Wave</span></div><div><b>${fmtTime(st.time)}</b><span>Time</span></div><div><b>${st.kills}</b><span>Enemies slain</span></div><div><b>${st.built}</b><span>Towers built</span></div><div><b>${st.gathered}</b><span>Resources gathered</span></div><div><b>${Math.ceil(r.hp)}</b><span>Base HP left</span></div></div>
    <div class="row">${r.mode === 'solo' ? '<button class="cta" id="again">Play again</button>' : ''}<button class="${r.mode === 'solo' ? 'btn' : 'cta'}" id="menu-btn">Main menu</button></div>`);
  const again = card.querySelector('#again');
  if (again) again.onclick = () => { const o = S.lastStart; leaveGame(); startGame(o); };
  card.querySelector('#menu-btn').onclick = () => leaveGame();
}

// ------------------------------------------------------------------ main loop
// One draw path: HDR scene + bloom + grading (post.js), or a plain render if post-processing is off.
function draw(scene, cam, look, t, flash = 0, fx = null) {
  if (post.enabled) { GFX.viewH = post.rt?.height || GFX.viewH; fx?.setView(GFX.viewH, cam.fov); post.render(scene, cam, look, t, flash); }
  else { GFX.viewH = renderer.getDrawingBufferSize(_v2).y; fx?.setView(GFX.viewH, cam.fov); renderer.toneMappingExposure = look.expo; renderer.render(scene, cam); }
}
const _v2 = new THREE.Vector2();
// Render-scale governor: if frames take too long the HDR target shrinks (and grows back when there is headroom).
const gov = { ema: 16, slow: 0, fast: 0, t: 0 };
function govern(realDt) {
  if (DEBUG || PROBE) return;                                   // automated tests render at a fixed scale
  gov.ema += (Math.min(realDt, 100) - gov.ema) * 0.08; gov.t += realDt;
  if (gov.t < 1000) return; gov.t = 0;
  if (document.hidden) return;
  if (gov.ema > 22) { gov.fast = 0; if (++gov.slow >= 2) { gov.slow = 0; post.setScale(post.scale - 0.1); } }
  else if (gov.ema < 13 && post.scale < 1) { gov.slow = 0; if (++gov.fast >= 4) { gov.fast = 0; post.setScale(post.scale + 0.05); } }
  else gov.slow = gov.fast = 0;
}
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); govern(now - last); last = now; S.frames++;
  try {
    const g = S.game;
    if (g) { g.update(dt); hud.update(dt); draw(g.scene, g.camera, g.world.look, g.t, Math.min(1, g.hitFlash * 1.6), g.fx); }
    else if (S.backdrop) { updateBackdrop(dt); draw(S.backdrop.world.scene, S.backdrop.cam, S.backdrop.world.look, S.backdrop.t); }
  } catch (e) {
    if (!S.errShown) { S.errShown = true; console.error(e); toast('Something went wrong: ' + e.message, 'warn'); }
  }
}

// ------------------------------------------------------------------ go
renderAll(); setBackdrop(); loadIcons();
requestAnimationFrame(frame);
if (S.name) signIn(S.name); else askName(true);
if (PROBE) window.__tf = { S, net, music, hud, renderer, post, applyQuality, startGame, startSolo, leaveGame, setEra, signIn, get game() { return S.game; } };
