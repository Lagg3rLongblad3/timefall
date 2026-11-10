// WebSocket client for the TIMEFALL lobby: identity, friends, challenges, quick match and the duel relay.
// Every server message is re-emitted by its `type` (friends, info, challenge, queued, matchStart, matchEnd, relay, error...),
// plus a synthetic 'status' event: 'offline' | 'connecting' | 'online'.
const TOKEN_KEY = 'timefall.token';

function getToken() { // a private per-browser secret that proves "this name is mine"
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      t = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); } // storage blocked: identity lasts for this tab only
}

export class Net {
  constructor() { this.ws = null; this.name = ''; this.status = 'offline'; this.handlers = {}; this.token = getToken(); this.retry = 0; this.want = false; this.timer = null; }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  emit(type, msg) { for (const fn of this.handlers[type] || []) { try { fn(msg); } catch (e) { console.error(e); } } }
  setStatus(s) { if (s !== this.status) { this.status = s; this.emit('status', s); } }
  get online() { return this.status === 'online'; }

  // Sign in as `name`. Resolves with the welcome message. Rejects with an Error (err.fatal is true when retrying cannot help,
  // e.g. the name belongs to someone else). After a successful sign-in, dropped connections are retried automatically.
  connect(name) {
    this.close();
    this.name = name; this.want = true; this.retry = 0;
    return new Promise((resolve, reject) => this.open(resolve, reject));
  }

  open(resolve, reject) {
    this.setStatus('connecting');
    let ws, settled = false;
    const settle = (fn, v) => { if (!settled && fn) { settled = true; fn(v); } };
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`); }
    catch { this.setStatus('offline'); return settle(reject, Object.assign(new Error('Could not reach the server.'), { fatal: false })); }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', name: this.name, token: this.token }));
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'welcome') { this.retry = 0; this.name = m.name; this.setStatus('online'); settle(resolve, m); }
      else if (m.type === 'error' && (m.fatal || this.status !== 'online')) { // refused before/while signing in: stop and report
        this.want = false; settle(reject, Object.assign(new Error(m.msg), { fatal: !!m.fatal }));
        this.emit('error', m); if (this.ws === ws) { this.ws = null; ws.close(); this.setStatus('offline'); } return;
      }
      this.emit(m.type, m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded or closed on purpose
      this.ws = null; this.setStatus('offline');
      settle(reject, Object.assign(new Error('Could not reach the server.'), { fatal: false }));
      if (this.want) this.schedule();
    };
    ws.onerror = () => {}; // onclose always follows
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.want) this.open(); }, Math.min(8000, 1000 * 2 ** this.retry++));
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  close() {
    this.want = false; clearTimeout(this.timer);
    const w = this.ws; this.ws = null;
    if (w) { try { w.close(); } catch {} }
    this.setStatus('offline');
  }
}
