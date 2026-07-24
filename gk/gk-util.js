// gamekit · gk-util.js — tiny helpers shared by every module and game.
// Load first. Everything lives under the single GK global.
window.GK = window.GK || {};

GK.util = {
  // HTML-escape untrusted text (profile names!) before innerHTML interpolation.
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },

  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  rand(a, b) { return a + Math.random() * (b - a); },
  irand(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

  // Lighten (+amt) or darken (-amt) a #rrggbb color.
  shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => GK.util.clamp(v, 0, 255);
    const r = c((n >> 16) + amt), g = c(((n >> 8) & 255) + amt), b = c((n & 255) + amt);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  },

  // Deterministic 2D hash -> [0,1). Handy for stable procedural decoration.
  hash2(r, c) {
    let n = (r * 374761393 + c * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  },

  // Turn any string into a 32-bit seed, so a daily challenge can be seeded off
  // a date ("2026-07-23") and every device generates the identical run.
  seedFrom(str) {
    let h = 2166136261 >>> 0;                       // FNV-1a
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  // Seeded RNG (mulberry32). Returns a callable that yields [0,1), with the
  // same conveniences as the unseeded helpers above hung off it:
  //
  //   const rng = GK.util.seededRand(GK.util.seedFrom("2026-07-23"));
  //   rng();                 // 0.417...
  //   rng.int(1, 6);         // inclusive
  //   rng.range(0, 10);      // [0,10)
  //   rng.pick(arr); rng.shuffle(arr);
  //
  // Never touches Math.random, so a run is reproducible: same seed, same
  // sequence, on every device and in a headless test. That's what makes
  // daily challenges shareable and balance bots deterministic (see
  // docs/testing.md).
  seededRand(seed = 0) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    // Fisher-Yates on a copy — callers keep their source array intact.
    next.shuffle = (arr) => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    return next;
  },
};
