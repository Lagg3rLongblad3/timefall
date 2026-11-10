// Procedural soundtrack: Ancient (modal drums, drone, oud, flute) <-> Futuristic (four-on-floor, saw bass, arps, pads)
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor() { this.ctx = null; this.era = 'ancient'; this.intensity = 0.4; this.muted = false; this.step = 0; this.bar = 0; this.next = 0; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    // shared echo
    this.echo = ctx.createDelay(1); this.echo.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
    this.echo.connect(lp); lp.connect(fb); fb.connect(this.echo); lp.connect(this.master);
    this.buses = {};
    for (const e of ['ancient', 'futuristic']) {
      const g = ctx.createGain(); g.gain.value = e === this.era ? 1 : 0;
      g.connect(this.master);
      const send = ctx.createGain(); send.gain.value = e === 'ancient' ? 0.22 : 0.3;
      g.connect(send); send.connect(this.echo);
      this.buses[e] = g;
    }
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.5; this.sfxBus.connect(this.master);
    const nl = ctx.sampleRate * 1; this.noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < nl; i++) d[i] = Math.random() * 2 - 1;
    this.next = ctx.currentTime + 0.1;
    setInterval(() => this.tick(), 40);
  }

  setEra(era) {
    if (era === this.era) return;
    this.era = era;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const e in this.buses) { const g = this.buses[e].gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(e === era ? 1 : 0, t + 1.6); }
    this.step = 0; this.bar = 0; this.next = t + 0.3;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }

  tick() {
    const ctx = this.ctx; if (!ctx) return;
    if (this.next < ctx.currentTime - 0.3) this.next = ctx.currentTime + 0.05; // timers were throttled (background tab): resync instead of replaying a burst
    const tempo = this.era === 'ancient' ? 92 : 126;
    const sd = 60 / tempo / 4;
    while (this.next < ctx.currentTime + 0.2) {
      if (this.era === 'ancient') this.ancientStep(this.step, this.bar, this.next, sd); else this.futureStep(this.step, this.bar, this.next, sd);
      this.next += sd; this.step++;
      if (this.step >= 16) { this.step = 0; this.bar++; }
    }
  }

  // ---------- primitives ----------
  tone(bus, type, f, t, dur, vol, o = {}) {
    const ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    let out = osc;
    if (o.lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(o.lp, t); if (o.lpTo) fl.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur); fl.Q.value = o.q || 1; osc.connect(fl); out = fl; }
    const a = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(g); g.connect(bus);
    if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2; lg.gain.value = o.vib; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05); }
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  noise(bus, t, dur, vol, type, freq, q = 1) {
    const ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // ---------- ANCIENT: D dorian, 92 bpm ----------
  ancientStep(s, bar, t, sd) {
    const b = this.buses.ancient, I = this.intensity;
    const roots = [38, 36, 38, 33], root = roots[bar % 4];
    if (s === 0) { // drone: root + fifth
      this.tone(b, 'sawtooth', mtof(root), t, sd * 16, 0.07, { lp: 380, attack: 0.4 });
      this.tone(b, 'sawtooth', mtof(root + 7), t, sd * 16, 0.04, { lp: 320, attack: 0.5, detune: 6 });
    }
    // frame drums
    if ([0, 6, 10].includes(s) || (I > 0.6 && s === 3)) this.tone(b, 'sine', 130, t, 0.28, 0.5, { slideTo: 55 });
    if ([4, 12].includes(s)) this.noise(b, t, 0.1, 0.22, 'bandpass', 1800, 2);
    if (I > 0.3 && [14, 15].includes(s) && bar % 2) this.noise(b, t, 0.07, 0.12, 'bandpass', 2400, 2);
    if (I > 0.55 && s % 2 === 1) this.noise(b, t, 0.04, 0.05, 'highpass', 6500);
    // oud-like plucks
    const scale = [0, 2, 3, 5, 7, 9, 10];
    const chordDeg = { 38: [0, 2, 4], 36: [6, 1, 3], 33: [4, 6, 1] }[root] || [0, 2, 4];
    if (s % 2 === 0 && (s % 8 === 0 || ((s * 7 + bar * 13) % 5) < 3 + (I > 0.5 ? 1 : 0))) {
      const deg = chordDeg[(s / 2 + bar) % 3 | 0] + (((s + bar) % 4 === 3) ? 1 : 0);
      const oct = 62 + (s > 8 ? 12 : 0);
      const m = oct - 2 + scale[((deg % 7) + 7) % 7];
      this.tone(b, 'triangle', mtof(m), t, 0.45, 0.16, { lp: 2400, lpTo: 500 });
      this.tone(b, 'square', mtof(m), t, 0.12, 0.03, { lp: 1800 });
    }
    // flute
    if (s === 0 && bar % 2 === 0) {
      const n = [74, 72, 77, 76][(bar / 2) % 4 | 0];
      this.tone(b, 'sine', mtof(n), t + 0.02, sd * 11, 0.09, { attack: 0.18, vib: 5 });
      this.noise(b, t, sd * 8, 0.012, 'bandpass', mtof(n) * 2, 3);
    }
    if (s === 8 && bar % 2 === 1) this.tone(b, 'sine', mtof(69), t, sd * 6, 0.07, { attack: 0.1, vib: 4 });
  }

  // ---------- FUTURISTIC: A minor, 126 bpm ----------
  futureStep(s, bar, t, sd) {
    const b = this.buses.futuristic, I = this.intensity;
    const k = bar % 4;
    const roots = [33, 29, 36, 31], root = roots[k];
    const chords = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], chord = chords[k];
    if (s % 4 === 0) this.tone(b, 'sine', 150, t, 0.22, 0.7, { slideTo: 42 });
    if (s % 4 === 2) this.noise(b, t, 0.08, 0.09 + I * 0.05, 'highpass', 7500);
    if (I > 0.5 && s % 2 === 1) this.noise(b, t, 0.03, 0.04, 'highpass', 9000);
    if (s === 4 || s === 12) this.noise(b, t, 0.16, 0.22, 'bandpass', 1500, 0.8);
    // bass
    if (s % 2 === 0) {
      const o = (s % 8 === 6) ? 12 : 0;
      this.tone(b, 'sawtooth', mtof(root + o), t, sd * 1.8, 0.22, { lp: 900, lpTo: 140, q: 6 });
    }
    // pad
    if (s === 0) chord.forEach((n, i) => this.tone(b, 'sawtooth', mtof(n), t, sd * 16, 0.035, { lp: 700 + (bar % 8) * 120, attack: 0.5, detune: (i - 1) * 9 }));
    // arp
    if (I > 0.25 || bar % 2) {
      const seq = [0, 1, 2, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 0];
      const n = chord[seq[s]] + 12 + ((s > 7 && bar % 2) ? 12 : 0);
      this.tone(b, 'square', mtof(n), t, sd * 0.9, 0.05, { lp: 1200 + ((bar % 8) * 400) + I * 1500, lpTo: 300 });
    }
    // lead hook every 4 bars
    if (k === 3 && I > 0.4 && [0, 3, 6, 10].includes(s)) this.tone(b, 'sawtooth', mtof([81, 79, 76, 74][[0, 3, 6, 10].indexOf(s)]), t, sd * 2.6, 0.07, { lp: 3500, lpTo: 900, vib: 4 });
  }

  // ---------- SFX ----------
  sfx(name, vol = 1) { // vol < 1 routes the sound through its own gain (distance falloff for far-away towers)
    if (!this.ctx || this.muted || vol < 0.04) return;
    const t = this.ctx.currentTime, fut = this.era === 'futuristic';
    let b = this.sfxBus;
    if (vol < 0.98) { b = this.ctx.createGain(); b.gain.value = vol; b.connect(this.sfxBus); }
    switch (name) {
      case 'gather': this.noise(b, t, 0.08, 0.3, 'bandpass', fut ? 3000 : 900, 3); this.tone(b, 'triangle', fut ? 900 : 220, t, 0.08, 0.2); break;
      case 'pickup': this.tone(b, 'sine', 660, t, 0.1, 0.2); this.tone(b, 'sine', 990, t + 0.07, 0.15, 0.2); break;
      case 'build': this.tone(b, 'square', 220, t, 0.12, 0.2, { slideTo: 440 }); this.noise(b, t, 0.15, 0.25, 'lowpass', 600); break;
      case 'error': this.tone(b, 'sawtooth', 120, t, 0.2, 0.2, { lp: 500 }); break;
      case 'shoot': fut ? this.tone(b, 'sawtooth', 900, t, 0.1, 0.06, { slideTo: 200, lp: 3000 }) : this.noise(b, t, 0.08, 0.1, 'bandpass', 1400, 2); break;
      case 'boom': this.noise(b, t, 0.4, 0.4, 'lowpass', 500); this.tone(b, 'sine', 100, t, 0.35, 0.4, { slideTo: 35 }); break;
      case 'zap': this.tone(b, 'sawtooth', 1400, t, 0.12, 0.07, { slideTo: 300 }); break;
      case 'die': this.tone(b, 'triangle', 300, t, 0.15, 0.12, { slideTo: 90 }); break;
      case 'leak': this.tone(b, 'sawtooth', 200, t, 0.5, 0.3, { slideTo: 60, lp: 800 }); break;
      case 'wave': [0, 5, 7].forEach((n, i) => this.tone(b, fut ? 'sawtooth' : 'triangle', mtof(57 + n), t + i * 0.12, 0.5, 0.18, { lp: 2000 })); break;
      case 'win': [0, 4, 7, 12, 16].forEach((n, i) => this.tone(b, 'triangle', mtof(60 + n), t + i * 0.13, 0.7, 0.2)); break;
      case 'lose': [0, -3, -7, -12].forEach((n, i) => this.tone(b, 'sawtooth', mtof(55 + n), t + i * 0.25, 0.9, 0.15, { lp: 700 })); break;
      case 'click': this.tone(b, 'sine', 800, t, 0.05, 0.12); break;
      case 'swing': // the blade (or the beam) whooshing through the air
        if (fut) this.tone(b, 'sawtooth', 260, t, 0.16, 0.05, { slideTo: 1100, lp: 2600 });
        else { this.noise(b, t, 0.10, 0.11, 'bandpass', 600, 1.4); this.noise(b, t + 0.045, 0.10, 0.10, 'bandpass', 1500, 1.2); }
        break;
    }
  }
}
