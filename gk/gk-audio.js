// gamekit · gk-audio.js — WebAudio sound engine, everything synthesized.
// Extracted from WordVoyage js/audio.js + Chicken Cross Sfx (identical cores).
//
// Games add their own jingles on top:
//   Object.assign(GK.Sfx, { hop(){ GK.Sfx.tone({freq:600, dur:0.06}); } });
//
// Call GK.Sfx.init() from the first user gesture (browsers refuse to start
// an AudioContext before one).
window.GK = window.GK || {};

GK.Sfx = {
  ctx: null,
  enabled: true,

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
};
