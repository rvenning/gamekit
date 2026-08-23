// gamekit · gk-audio.js — WebAudio sound engine, everything synthesized.
// Extracted from WordVoyage js/audio.js + Chicken Cross Sfx (identical cores).
//
// Games add their own jingles on top:
//   Object.assign(GK.Sfx, { hop(){ GK.Sfx.tone({freq:600, dur:0.06}); } });
//
// A browser refuses to start an AudioContext outside a user gesture, so the
// kit wakes itself on the first one (see _autoUnlock at the bottom) — games no
// longer have to remember GK.Sfx.init(), and calling it anyway is harmless.
window.GK = window.GK || {};

GK.Sfx = {
  ctx: null,
  enabled: true,
  plays: 0,       // notes actually sounded — GK.UI.bindMenuClicks reads this

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  // One oscillator note. slide bends the pitch by +/-Hz over the duration.
  tone({ freq = 440, type = "sine", dur = 0.15, vol = 0.25, when = 0, slide = 0 }) {
    if (!this.enabled || !this.ctx) return;
    this.plays++;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  },

  // White-noise burst (splashes, crashes, whooshes).
  noise({ dur = 0.3, vol = 0.2, when = 0 }) {
    if (!this.enabled || !this.ctx) return;
    this.plays++;
    const t = this.ctx.currentTime + when;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g).connect(this.ctx.destination);
    src.start(t);
  },

  /* ----- default sounds every game seems to need ----- */
  click() { this.tone({ freq: 600, type: "sine", dur: 0.05, vol: 0.1 }); },
  coin() {
    this.tone({ freq: 990, type: "square", dur: 0.07, vol: 0.12 });
    this.tone({ freq: 1320, type: "square", dur: 0.18, vol: 0.12, when: 0.07 });
  },
  win() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => this.tone({ freq: f, type: "triangle", dur: 0.25, vol: 0.25, when: i * 0.12 }));
    notes.forEach((f, i) => this.tone({ freq: f / 2, type: "sine", dur: 0.3, vol: 0.15, when: i * 0.12 }));
  },
  lose() { [440, 392, 349, 294].forEach((f, i) => this.tone({ freq: f, type: "triangle", dur: 0.3, vol: 0.2, when: i * 0.14 })); },
  wrong() { this.tone({ freq: 160, type: "sawtooth", dur: 0.25, vol: 0.18, slide: -60 }); },

  /* ----- waking the context up ----- */

  // Every sound above no-ops on a null ctx, so a game that only called init()
  // once play started had a completely silent front end: splash, profile
  // cards, PIN pad, level select. Wake on the first gesture instead, in the
  // CAPTURE phase, so the context exists before the button's own handler runs
  // and that very click is audible.
  //
  // Deliberately not { once: true }: iOS suspends the context whenever the app
  // is backgrounded and never resumes it by itself, so a phone that has been in
  // a pocket mid-game comes back mute. init() is idempotent and resumes a
  // suspended context, and every one of these events is a real gesture.
  _autoUnlock() {
    if (typeof document === "undefined" || this._unlocking) return;
    this._unlocking = true;
    const wake = () => this.init();
    for (const ev of ["pointerdown", "mousedown", "touchstart", "keydown"])
      document.addEventListener(ev, wake, { capture: true, passive: true });
  },
};

GK.Sfx._autoUnlock();
