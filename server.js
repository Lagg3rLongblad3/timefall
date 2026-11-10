// TIMEFALL server: static files + WebSocket lobby (friends, challenges, quick match, relay)
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// A plain-English message instead of a stack trace when `npm install` has not been run.
let WebSocketServer;
try { ({ WebSocketServer } = await import('ws')); }
catch { console.error('\nTIMEFALL is missing its dependencies.\nRun "npm install" in this folder, then "npm start" again.\n'); process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXED_PORT = Boolean(process.env.PORT);      // an explicit PORT is respected; otherwise a free one is searched for
const START_PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.TIMEFALL_DB || path.join(__dirname, 'friends.json');
const PUBLIC = path.join(__dirname, 'public');
const THREE_BUILD = path.join(__dirname, 'node_modules/three/build');
if (!fs.existsSync(path.join(THREE_BUILD, 'three.module.js'))) { console.error('\nThe "three" package is missing.\nRun "npm install" in this folder, then "npm start" again.\n'); process.exit(1); }
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const CHALLENGE_TTL = 90_000;

let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
// Player names are user input, so keep them in a prototype-less map ("constructor" must not resolve to a user).
db.users = Object.assign(Object.create(null), db.users);
const save = () => fs.writeFile(DB_FILE, JSON.stringify(db), () => {});

function serve(req, res) {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (url.includes('\0')) { res.writeHead(400); return res.end('Bad request'); }
  if (url === '/') url = '/index.html';
  const full = path.resolve(url.startsWith('/vendor/three/') ? path.join(THREE_BUILD, url.slice(14)) : path.join(PUBLIC, url));
  if (![PUBLIC, THREE_BUILD].some(dir => full.startsWith(dir + path.sep))) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(serve);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('error', () => {}); // listen errors (e.g. port in use) are handled where we call listen()

const online = new Map();      // name -> client
let quickQueue = null;         // waiting client
const pending = new Map();     // `${from}>${to}` -> { era, map, at }
let matchId = 1;

const send = (c, o) => { if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); };
const info = (c, msg) => send(c, { type: 'info', msg });
const clean = s => String(s ?? '').replace(/[^\w \-]/g, '').trim().slice(0, 16);
const ERA = e => (e === 'ancient' ? 'ancient' : 'futuristic');
const MAP = m => { m = Math.floor(Number(m)); return m >= 0 && m <= 5 ? m : 0; };

function friendState(name) {
  const u = db.users[name];
  return {
    type: 'friends',
    friends: u.friends.map(f => ({ name: f, online: online.has(f), busy: !!online.get(f)?.match })),
    requests: u.requests,
  };
}
const pushFriends = name => { const c = online.get(name); if (c) send(c, friendState(name)); };
const notifyFriendsOf = name => db.users[name].friends.forEach(pushFriends);

function startMatch(a, b, settings) {
  const id = matchId++;
  const seed = Math.floor(Math.random() * 1e9);
  a.match = { id, opp: b }; b.match = { id, opp: a };
  if (quickQueue === a || quickQueue === b) quickQueue = null;
  const base = { type: 'matchStart', id, seed, era: settings.era, map: settings.map };
  send(a, { ...base, opponent: b.name, side: 0 });
  send(b, { ...base, opponent: a.name, side: 1 });
  notifyFriendsOf(a.name); notifyFriendsOf(b.name);
}
function endMatch(c, reason) {
  if (!c.match) return;
  const opp = c.match.opp;
  c.match = null;
  if (opp.match) { opp.match = null; send(opp, { type: 'matchEnd', reason }); }
  notifyFriendsOf(c.name); notifyFriendsOf(opp.name);
}

function handle(c, m) {
  if (m.type === 'hello') {
    if (c.name) return; // one identity per connection
    const name = clean(m.name), token = String(m.token ?? '').slice(0, 64);
    if (!name) return send(c, { type: 'error', msg: 'Pick a display name.' });
    if (token.length < 8) return send(c, { type: 'error', msg: 'Bad client token.', fatal: true });
    let u = db.users[name];
    if (u && u.token !== token) return send(c, { type: 'error', msg: `"${name}" is taken. Pick another name.`, fatal: true });
    const old = online.get(name); // same owner (token matches) signing in again, e.g. after a dropped connection: take over
    if (old) { send(old, { type: 'error', msg: 'Signed in from another tab.', fatal: true }); old.ws.close(); }
    if (!u) { u = db.users[name] = { token, friends: [], requests: [] }; save(); }
    c.name = name; online.set(name, c);
    send(c, { ...friendState(name), type: 'welcome', name }); // spread first: friendState() carries its own type
    notifyFriendsOf(name);
    return;
  }
  if (!c.name) return;
  const u = db.users[c.name];
  switch (m.type) {
    case 'addFriend': {
      const t = clean(m.name);
      if (t === c.name) return info(c, 'You cannot add yourself.');
      const tu = db.users[t];
      if (!tu) return info(c, 'No player with that name.');
      if (u.friends.includes(t)) return info(c, 'Already friends.');
      if (u.requests.includes(t)) { // they already asked us: accept
        u.requests = u.requests.filter(x => x !== t);
        u.friends.push(t); tu.friends.push(c.name); save();
        pushFriends(c.name); pushFriends(t);
        return info(c, `You and ${t} are now friends!`);
      }
      if (!tu.requests.includes(c.name)) tu.requests.push(c.name);
      save(); pushFriends(t);
      info(online.get(t), `${c.name} sent you a friend request.`);
      return info(c, `Friend request sent to ${t}.`);
    }
    case 'acceptFriend': {
      const t = clean(m.name), tu = db.users[t];
      if (!tu || !u.requests.includes(t)) return;
      u.requests = u.requests.filter(x => x !== t);
      if (m.accept) {
        if (!u.friends.includes(t)) u.friends.push(t);
        if (!tu.friends.includes(c.name)) tu.friends.push(c.name);
      }
      save(); pushFriends(c.name); pushFriends(t);
      if (m.accept) info(online.get(t), `${c.name} accepted your friend request!`);
      return;
    }
    case 'removeFriend': {
      const t = clean(m.name);
      if (!u.friends.includes(t)) return;
      u.friends = u.friends.filter(x => x !== t);
      if (db.users[t]) db.users[t].friends = db.users[t].friends.filter(x => x !== c.name);
      save(); pushFriends(c.name); pushFriends(t); return;
    }
    case 'challenge': {
      const target = clean(m.name), t = online.get(target);
      if (!t || !u.friends.includes(target)) return info(c, 'That friend is not online.');
      if (t.match || c.match) return info(c, 'Someone is already in a match.');
      const era = ERA(m.era);
      pending.set(`${c.name}>${t.name}`, { era, map: MAP(m.map), at: Date.now() });
      send(t, { type: 'challenge', from: c.name, era });
      return info(c, `Challenge sent to ${t.name}…`);
    }
    case 'challengeReply': {
      const from = clean(m.from), key = `${from}>${c.name}`;
      const s = pending.get(key); pending.delete(key);
      const f = online.get(from);
      if (!s || !f || Date.now() - s.at > CHALLENGE_TTL) return info(c, 'Challenge expired.');
      if (!m.accept) return info(f, `${c.name} declined your challenge.`);
      if (f.match || c.match) { info(c, 'Someone is already in a match.'); return info(f, 'Someone is already in a match.'); }
      return startMatch(f, c, s);
    }
    case 'quick': {
      if (c.match) return;
      if (!m.on) { if (quickQueue === c) quickQueue = null; return; }
      if (quickQueue && quickQueue !== c && quickQueue.ws.readyState === 1) {
        const other = quickQueue; quickQueue = null;
        return startMatch(other, c, other.quickSettings);
      }
      c.quickSettings = { era: ERA(m.era), map: Math.floor(Math.random() * 6) };
      quickQueue = c;
      return send(c, { type: 'queued' });
    }
    case 'relay':
      if (c.match) send(c.match.opp, { type: 'relay', data: m.data });
      return;
    case 'leaveMatch': return endMatch(c, 'left');
  }
}

wss.on('connection', ws => {
  const c = { ws, name: null, match: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    try { handle(c, m); } catch (e) { console.error('message handler failed:', e); }
  });
  ws.on('close', () => {
    if (quickQueue === c) quickQueue = null;
    if (c.match) endMatch(c, 'disconnected');
    if (c.name) {
      for (const k of pending.keys()) if (k.startsWith(c.name + '>') || k.endsWith('>' + c.name)) pending.delete(k);
      if (online.get(c.name) === c) { online.delete(c.name); notifyFriendsOf(c.name); }
    }
  });
});

// Drop connections that went silent (laptop lid closed, wifi lost) so nobody stays "online" or in the quick-match queue forever.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30_000);
wss.on('close', () => clearInterval(heartbeat));

const lanUrls = port => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${port}`);

function openBrowser(url) { // a convenience only: any failure is ignored
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { const p = spawn(cmd, args, { stdio: 'ignore', detached: true }); p.on('error', () => {}); p.unref(); } catch {}
}

let onError;
function start(port, tries = 0) {
  if (onError) server.off('error', onError);
  onError = e => {
    if (e.code === 'EADDRINUSE' && !FIXED_PORT && tries < 25) { console.log(`Port ${port} is busy, trying ${port + 1}...`); return start(port + 1, tries + 1); }
    if (e.code === 'EADDRINUSE') console.error(`\nPort ${port} is already in use (is TIMEFALL already running?).\nClose whatever is using it, or pick another port, e.g.  PORT=4000 npm start\n`);
    else console.error(e);
    process.exit(1);
  };
  server.once('error', onError);
  server.listen(port); // no callback here: a failed attempt would leave it registered and it would fire later with a stale port
}
server.once('listening', () => { // fires once, for whichever port finally worked
  server.off('error', onError);
  const port = server.address().port, url = `http://localhost:${port}`, lan = lanUrls(port);
  console.log(`\n  TIMEFALL is running\n\n  Open this in your browser:   ${url}`);
  if (lan.length) console.log(`  Friends on your network:     ${lan.join('   ')}`);
  console.log('\n  Press Ctrl+C to stop.\n');
  if (process.stdout.isTTY && !process.env.NO_OPEN && !process.argv.includes('--no-open')) openBrowser(url); // npm start from a terminal opens the game for you
});
start(START_PORT);
