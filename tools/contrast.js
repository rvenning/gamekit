#!/usr/bin/env node
/* gamekit · tools/contrast.js — WCAG 2.x contrast measurement.

   The kit's buttons print white lettering on a themed background, so every
   --gk-* button colour is a contrast decision. Eyeballing those is how the
   1.79:1 accent button shipped, so measure instead:

     node tools/contrast.js "#ffb32b" "#ffffff"       # one pair
     node tools/contrast.js --css path/to/style.css   # every --gk-* token

   Not vendored into games (sync-to-game.js copies gk/* and tools/png.js only).

   WCAG 2.x thresholds: 4.5 for normal text, 3.0 for large text
   (>=18.66px bold, or >=24px). .btn is 19px/800 and so counts as large,
   but the kit aims for 4.5 so that a smaller label added to a button later
   (.btn .sub, used by several games) does not drop under the bar. */

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

function parseHex(hex) {
  const s = String(hex).trim().replace(/^#/, "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

// WCAG 2.x relative luminance: linearise each sRGB channel, then weight.
function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Round DOWN to 2dp: a value that measures 4.499 must never print as "4.50"
// next to a 4.5 threshold it does not actually meet.
const fmt = (n) => (Math.floor(n * 100) / 100).toFixed(2);

function report(colour, against, label) {
  const r = contrast(colour, against);
  const mark = r >= AA_NORMAL ? "PASS" : r >= AA_LARGE ? "large-only" : "FAIL";
  return `${label.padEnd(22)} ${colour.padEnd(9)} vs ${against}  ${fmt(r).padStart(6)}  ${mark}`;
}

function scanCss(file) {
  const src = require("fs").readFileSync(file, "utf8");
  // Last declaration of each token wins, matching the cascade within one file.
  const tokens = new Map();
  for (const m of src.matchAll(/(--gk-[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*[;}]/g)) {
    tokens.set(m[1], m[2]);
  }
  const ink = tokens.get("--gk-ink") || "#12232e";
  const out = [];
  for (const [name, colour] of tokens) {
    if (/-sh$/.test(name) || name === "--gk-ink") continue;   // shadows carry no text
    if (!/^#[0-9a-fA-F]{6}$/.test(colour)) continue;          // skip alpha forms
    out.push(report(colour, "#ffffff", name) + "   | vs ink " + fmt(contrast(colour, ink)));
  }
  return { ink, lines: out };
}

module.exports = { contrast, luminance, parseHex, AA_NORMAL, AA_LARGE };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "--css") {
    const { ink, lines } = scanCss(args[1]);
    console.log(`${args[1]}  (ink ${ink})`);
    console.log(lines.length ? lines.join("\n") : "  no --gk-* colour tokens");
  } else if (args.length >= 2) {
    console.log(report(args[0], args[1], "pair"));
  } else {
    console.log('usage: contrast.js "#hex" "#hex"  |  contrast.js --css <file>');
    process.exit(1);
  }
}
