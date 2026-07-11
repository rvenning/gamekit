// Generates the demo's PWA icons using the kit's PNG painter.
// Run: node demo/make-icons.js   (from the repo root)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../tools/png.js");

function drawIcon(size, scale) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  cv.fillRect(0, 0, big, big, "#47307f");
  const cx = big / 2, cy = big / 2, r = big * scale;
  // bullseye
  for (const [f, col] of [[1, "#ffffff"], [0.78, "#e0455c"], [0.56, "#ffffff"], [0.34, "#e0455c"], [0.14, "#ffd93b"]]) {
    cv.fillCircle(cx, cy, r * f, col);
  }
  return encodePNG(size, size, downsample(cv.px, big, SS));
}

const out = path.join(__dirname, "icons");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon-512.png"), drawIcon(512, 0.42));
fs.writeFileSync(path.join(out, "icon-192.png"), drawIcon(192, 0.42));
fs.writeFileSync(path.join(out, "maskable-512.png"), drawIcon(512, 0.32));
console.log("demo icons written");
