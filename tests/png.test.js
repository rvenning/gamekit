"use strict";
// Tests for tools/png.js. The encoder has been exercised by every game's icon
// build for a year; the decoder is new, and it is the thing the Aquamarine map
// extractor trusts to read printed gamesheets cell by cell. A decoder that is
// subtly wrong -- one row off, one channel swapped -- produces a map that is
// plausible and unplayable, so the tests below round-trip known pixels through
// every filter type rather than eyeballing an output image.
//
//   cd gamekit && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");
const { encodePNG, decodePNG } = require("../tools/png.js");

// A small image with structure in it: a horizontal gradient, a vertical one,
// and a diagonal, so a decoder that mixes up x and y or drops a row fails.
function fixture(w, h) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = (x * 7) & 255;
      rgba[i + 1] = (y * 11) & 255;
      rgba[i + 2] = ((x + y) * 13) & 255;
      rgba[i + 3] = 255;
    }
  return rgba;
}

test("round-trips an encoded image byte for byte", () => {
  const w = 23, h = 17;              // deliberately not a power of two
  const src = fixture(w, h);
  const out = decodePNG(encodePNG(w, h, src));
  assert.equal(out.width, w);
  assert.equal(out.height, h);
  assert.deepEqual(out.rgba, src);
});

// encodePNG writes filter 0 rows. Real files from a design tool use all five,
// so build them by hand: same pixels, every filter, must decode identically.
function encodeWithFilters(w, h, rgba, filters) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  const prev = Buffer.alloc(w * 4);
  const cur = Buffer.alloc(w * 4);
  for (let y = 0; y < h; y++) {
    rgba.copy(cur, 0, y * w * 4, (y + 1) * w * 4);
    const f = filters[y % filters.length];
    const o = y * (w * 4 + 1);
    raw[o] = f;
    for (let x = 0; x < w * 4; x++) {
      const a = x >= 4 ? cur[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      let v = cur[x];
      if (f === 1) v -= a;
      else if (f === 2) v -= b;
      else if (f === 3) v -= (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v -= pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[o + 1 + x] = v & 255;
    }
    cur.copy(prev);
  }
  // Reassemble a minimal PNG around the hand-filtered pixel data.
  const png = encodePNG(w, h, rgba);
  const head = png.subarray(0, png.indexOf(Buffer.from("IDAT", "ascii")) - 4);
  const body = zlib.deflateSync(raw);
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  chunk.write("IDAT", 4, "ascii");
  body.copy(chunk, 8);
  // CRC is checked by nothing in our decoder, but write a real one anyway.
  let crc = -1;
  for (let i = 4; i < 8 + body.length; i++) {
    crc ^= chunk[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ -1) >>> 0, 8 + body.length);
  const tail = png.subarray(png.length - 12);
  return Buffer.concat([head, chunk, tail]);
}

test("decodes every scanline filter type", () => {
  const w = 19, h = 13;
  const src = fixture(w, h);
  for (const f of [0, 1, 2, 3, 4]) {
    const out = decodePNG(encodeWithFilters(w, h, src, [f]));
    assert.deepEqual(out.rgba, src, "filter " + f);
  }
  // And mixed, which is what a real encoder emits.
  assert.deepEqual(decodePNG(encodeWithFilters(w, h, src, [0, 1, 2, 3, 4])).rgba, src);
});

test("reads a real gamesheet and its icons", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const sheet = "D:/dev/print-and-plays/Aquamarine/GAMESHEETS/MAP01/Aquamarine_Map1_Low-Ink.png";
  if (!fs.existsSync(sheet)) return;   // print-and-play folder is not in the repo
  const img = decodePNG(fs.readFileSync(sheet));
  assert.equal(img.width, 1743);
  assert.equal(img.height, 2340);
  assert.equal(img.rgba.length, 1743 * 2340 * 4);
  // Printed sheets are ink on white: the corner must be paper, and the page
  // must be mostly paper, or we have decoded something other than the image.
  assert.ok(img.rgba[0] > 240 && img.rgba[1] > 240 && img.rgba[2] > 240);
  let light = 0;
  for (let i = 0; i < img.rgba.length; i += 4 * 97) if (img.rgba[i] > 200) light++;
  assert.ok(light / (img.rgba.length / (4 * 97)) > 0.6, "sheet should be mostly white");
});

test("refuses what it cannot decode", () => {
  assert.throws(() => decodePNG(Buffer.from("this is not a png")), /not a PNG/);
});
