// gamekit · gk-fx.js — canvas juice layer: pooled particles, screen shake,
// full-screen flash, floating text, lightning, confetti, slow-motion, tweens.
//
// Extracted from Brick Breaker DX's js/fx.js, with Deep Jungle's emitters
// (dust/sparkle/splash) and Block Party's confetti folded back in. Those three
// hand-rolled copies had already drifted apart; this is the one tuned version.
//
// Engine-agnostic and canvas-space: the game owns the transform, and calls
//   GK.Fx.update(dt)   // dt in REAL seconds
//   GK.Fx.render(ctx)  // after its own world/camera transform
//
// Feel is per-game. Call configure() once at boot to keep a game's own tuning:
//   GK.Fx.configure({ grav: 300, poolCap: 700, shape: "square" });
window.GK = window.GK || {};

GK.Fx = {
  // Defaults are Brick Breaker DX's numbers -- it was the source of the layer.
  cfg: {
    grav: 260,          // px/s^2 pulling burst particles down
    poolCap: 900,       // oldest particles are dropped past this
    shakeMax: 14,       // shake saturates here, so a pile-up can't blind the player
    shakeDecay: 26,     // shake units bled off per second
    flashDecay: 3.2,
    shape: "circle",    // "circle" or "square" -- how a plain particle draws
    burstSpeed: 160,
    burstSize: 3,
    textCap: 40,
    textSize: 16,
    textDy: -46,
    font: "'Baloo 2',sans-serif",
  },
  configure(opts) { Object.assign(this.cfg, opts); return this; },

  parts: [],      // particle pool (recycled)
  texts: [],      // floating score/combo popups
  bolts: [],      // short-lived lightning polylines
  shake: 0,       // current shake magnitude (logical px)
  flash: 0,       // full-screen flash alpha
  flashColor: "#ffffff",
  timeScale: 1,   // <1 = slow motion
  slowT: 0,

  reset() { this.parts.length = 0; this.texts.length = 0; this.bolts.length = 0;
            this.shake = 0; this.flash = 0; this.timeScale = 1; this.slowT = 0; },

  /* ---- emitters ---- */
  burst(x, y, color, n = 12, speed = this.cfg.burstSpeed, life = 0.5, size = this.cfg.burstSize) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random() * 0.65);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.4), t: 0, color, size: size * (0.6 + Math.random() * 0.8),
        grav: this.cfg.grav, spark: Math.random() < 0.3 });
    }
    this.trim();
  },

  trail(x, y, color, size = 2.5) {
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0.28, t: 0, color, size, grav: 0, fadeOnly: true });
    this.trim();
  },

  // Kicked-up ground dust: drifts sideways and floats slightly upward.
  dust(x, y, n = 6, color = "rgba(220,205,170,0.8)") {
    for (let i = 0; i < n; i++) {
      this.parts.push({ x: x + (Math.random() - 0.5) * 10, y,
        vx: (Math.random() - 0.5) * 46, vy: -18 - Math.random() * 26,
        life: 0.32 + Math.random() * 0.22, t: 0, color, size: 1.6 + Math.random() * 1.6,
        grav: -30 });
    }
    this.trim();
  },

  sparkle(x, y, color = "#fff7c0", n = 5) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 12,
        vx: 0, vy: -12, life: 0.5 + Math.random() * 0.3, t: 0, color,
        size: 1.4 + Math.random() * 1.2, grav: 0, spark: true });
    }
    this.trim();
  },

  splash(x, y, color = "#9fdcf0", n = 10) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ x: x + (Math.random() - 0.5) * 10, y,
        vx: (Math.random() - 0.5) * 110, vy: -60 - Math.random() * 90,
        life: 0.45 + Math.random() * 0.2, t: 0, color, size: 1.6 + Math.random() * 1.4, grav: 420 });
    }
    this.trim();
  },

  // Celebration shower across the top of a w x h canvas. Tumbling rectangles
  // rather than dots, and culled once they fall past the bottom edge.
  confetti(w, h, colors, n = 90) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ x: Math.random() * w, y: -60 + Math.random() * 60,
        vx: -40 + Math.random() * 80, vy: 60 + Math.random() * 160,
        life: 1.2 + Math.random() * 1.0, t: 0,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 5 + Math.random() * 5, grav: 420,
        spin: -8 + Math.random() * 16, a: Math.random() * 6,
        shape: "rect", maxY: h + 30 });
    }
    this.trim();
  },

  text(x, y, str, { color = "#fff", size = this.cfg.textSize, dy = this.cfg.textDy, life = 0.9 } = {}) {
    this.texts.push({ x, y, str, color, size, dy, life, t: 0 });
    if (this.texts.length > this.cfg.textCap) this.texts.shift();
  },

  lightning(x1, y1, x2, y2, color = "#fde047") {
    const pts = [[x1, y1]];
    const segs = 6;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      pts.push([x1 + (x2 - x1) * t + (Math.random() - 0.5) * 16,
                y1 + (y2 - y1) * t + (Math.random() - 0.5) * 16]);
    }
    pts.push([x2, y2]);
    this.bolts.push({ pts, color, life: 0.16, t: 0 });
  },

  addShake(amount) { this.shake = Math.min(this.cfg.shakeMax, this.shake + amount); },
  addFlash(alpha, color = "#ffffff") { this.flash = Math.max(this.flash, alpha); this.flashColor = color; },
  slowMo(scale = 0.3, dur = 0.5) { this.timeScale = scale; this.slowT = dur; },

  trim() { if (this.parts.length > this.cfg.poolCap) this.parts.splice(0, this.parts.length - this.cfg.poolCap); },

  // Shake offset for the game to translate by, if it wants one.
  shakeOffset() {
    if (this.shake <= 0) return [0, 0];
    return [(Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake];
  },

  /* ---- frame ---- */
  update(dt) {   // dt = REAL seconds (slow-mo must not slow its own recovery)
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.timeScale = 1; }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * this.cfg.shakeDecay);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * this.cfg.flashDecay);
    const sdt = dt * this.timeScale;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += sdt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * sdt; p.y += p.vy * sdt; p.vy += p.grav * sdt;
      if (p.spin) p.a += p.spin * sdt;
      if (p.maxY != null && p.y > p.maxY) { this.parts.splice(i, 1); continue; }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      if (t.t >= t.life) this.texts.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.life) this.bolts.splice(i, 1);
    }
  },

  render(ctx) {
    const shape = this.cfg.shape;
    for (const p of this.parts) {
      const k = 1 - p.t / p.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      const s = p.size * (p.fadeOnly ? k : 1);
      if (p.spark) { ctx.fillRect(p.x - s / 2, p.y - s * 1.5, s * 0.7, s * 3); continue; }
      if (p.shape === "rect") {                       // tumbling confetti
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a || 0);
        ctx.fillRect(-s / 2, -s * 0.35, s, s * 0.7);
        ctx.restore(); continue;
      }
      if ((p.shape || shape) === "square") ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    for (const b of this.bolts) {
      ctx.globalAlpha = 1 - b.t / b.life;
      ctx.strokeStyle = b.color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.pts[0][0], b.pts[0][1]);
      for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i][0], b.pts[i][1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of this.texts) {
      const k = t.t / t.life;
      const pop = k < 0.15 ? k / 0.15 : 1;             // scale-in pop
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.font = `800 ${Math.round(t.size * (0.6 + 0.4 * pop))}px ${this.cfg.font}`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y + t.dy * k);
    }
    ctx.globalAlpha = 1;
  },
};

// Minimal tween runner for UI/paddle squash (value objects, ease-out cubic).
GK.Tween = {
  list: [],
  to(obj, props, dur, ease = t => 1 - Math.pow(1 - t, 3)) {
    const from = {};
    for (const k in props) from[k] = obj[k];
    this.list.push({ obj, from, to: props, dur, t: 0, ease });
  },
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur), e = tw.ease(k);
      for (const key in tw.to) tw.obj[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
      if (k >= 1) this.list.splice(i, 1);
    }
  },
  clear() { this.list.length = 0; },
};
