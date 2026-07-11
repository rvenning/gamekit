// gamekit · tools/png.js — dependency-free PNG writer + shape rasterizer.
// Node-only build tool (uses zlib); games use it to generate PWA icons:
//
//   const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");
//   const cv = makeCanvas(2048);            // render 4x for antialiasing
//   cv.fillRect(0,0,2048,2048,"#6bbf4a");
//   cv.fillCircle(1024,1024,600,"#ffffff");
//   fs.writeFileSync("icon-512.png", encodePNG(512,512,downsample(cv.px,2048,4)));
//
// Extracted from Chicken Cross tools/make-icons.js.

const zlib = require("zlib");

/* ---------------------------------------------------------- PNG encoding */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h); // filter byte 0 per scanline
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------- rasterization */
function makeCanvas(size) {
  const px = Buffer.alloc(size * size * 4);
  const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const set = (x, y, [r, g, b], a = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i]     = Math.round(r * a + px[i]     * (1 - a));
    px[i + 1] = Math.round(g * a + px[i + 1] * (1 - a));
    px[i + 2] = Math.round(b * a + px[i + 2] * (1 - a));
    px[i + 3] = 255;
  };
  return {
    px, size,
    fillRect(x, y, w, h, color, a = 1) {
      const c = hex(color);
      for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
        for (let xx = Math.round(x); xx < Math.round(x + w); xx++) set(xx, yy, c, a);
    },
    fillEllipse(cx, cy, rx, ry, color, a = 1) {
      const c = hex(color);
      for (let yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy++)
        for (let xx = Math.floor(cx - rx); xx <= Math.ceil(cx + rx); xx++) {
          const dx = (xx - cx) / rx, dy = (yy - cy) / ry;
          if (dx * dx + dy * dy <= 1) set(xx, yy, c, a);
        }
    },
    fillCircle(cx, cy, r, color, a = 1) { this.fillEllipse(cx, cy, r, r, color, a); },
    fillRoundRect(x, y, w, h, r, color, a = 1) {
      r = Math.min(r, w / 2, h / 2);
      this.fillRect(x + r, y, w - 2 * r, h, color, a);
      this.fillRect(x, y + r, w, h - 2 * r, color, a);
      this.fillCircle(x + r, y + r, r, color, a);
      this.fillCircle(x + w - r, y + r, r, color, a);
      this.fillCircle(x + r, y + h - r, r, color, a);
      this.fillCircle(x + w - r, y + h - r, r, color, a);
    },
    fillTriangle(x1, y1, x2, y2, x3, y3, color, a = 1) {
      const c = hex(color);
      const minX = Math.floor(Math.min(x1, x2, x3)), maxX = Math.ceil(Math.max(x1, x2, x3));
      const minY = Math.floor(Math.min(y1, y2, y3)), maxY = Math.ceil(Math.max(y1, y2, y3));
      const sign = (ax, ay, bx, by, px2, py2) => (ax - px2) * (by - py2) - (bx - px2) * (ay - py2);
      for (let yy = minY; yy <= maxY; yy++)
        for (let xx = minX; xx <= maxX; xx++) {
          const d1 = sign(x1, y1, x2, y2, xx, yy), d2 = sign(x2, y2, x3, y3, xx, yy), d3 = sign(x3, y3, x1, y1, xx, yy);
          if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) set(xx, yy, c, a);
        }
    },
  };
}

// Integer box downsample (render at size*factor, average down = antialiasing).
function downsample(src, srcSize, factor) {
  const dstSize = srcSize / factor;
  const out = Buffer.alloc(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++)
    for (let x = 0; x < dstSize; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * srcSize + x * factor + dx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2];
        }
      const n = factor * factor, o = (y * dstSize + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  return out;
}

module.exports = { encodePNG, makeCanvas, downsample };
