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
};
