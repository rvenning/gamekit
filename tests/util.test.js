"use strict";
// Tests for gk-util.js, focused on the seeded RNG. The properties that matter
// are determinism (same seed -> same run, so a daily challenge is identical on
// every device and a balance bot reproduces its failures) and independence
// from Math.random (or none of that holds).
//
//   cd gamekit && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../tools/test-harness.js");

const GK_DIR = path.join(__dirname, "..", "gk");
const load = () => loadScripts({ baseDir: GK_DIR, files: ["gk-util.js"], browser: true }).GK.util;

const util = load();
const draw = (rng, n = 20) => Array.from({ length: n }, () => rng());

test("the same seed replays the same sequence", () => {
  const a = draw(util.seededRand(12345));
  const b = draw(util.seededRand(12345));
  assert.deepEqual(a, b);
});

test("different seeds diverge", () => {
  const a = draw(util.seededRand(1));
  const b = draw(util.seededRand(2));
  assert.notDeepEqual(a, b);
});

test("a seeded sequence survives a fresh module load — it's in the algorithm, not module state", () => {
  const first = draw(util.seededRand(999));
  const second = draw(load().seededRand(999));   // separate sandbox entirely
  assert.deepEqual(first, second);
});

test("output stays in [0,1)", () => {
  const rng = util.seededRand(7);
  for (let i = 0; i < 5000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("it never touches Math.random", () => {
  const real = Math.random;
  Math.random = () => { throw new Error("seeded RNG must not call Math.random"); };
  try {
    const rng = util.seededRand(42);
    assert.doesNotThrow(() => {
      rng(); rng.int(1, 6); rng.range(0, 5); rng.pick([1, 2, 3]); rng.shuffle([1, 2, 3, 4]);
    });
  } finally { Math.random = real; }
});

test("int() is inclusive at both ends and never escapes them", () => {
  const rng = util.seededRand(3);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = rng.int(1, 6);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 6, `bad die roll: ${v}`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6], "every face should turn up");
});

test("int() handles a single-value range", () => {
  const rng = util.seededRand(5);
  for (let i = 0; i < 50; i++) assert.equal(rng.int(4, 4), 4);
});

test("range() stays within [lo,hi)", () => {
  const rng = util.seededRand(11);
  for (let i = 0; i < 2000; i++) {
    const v = rng.range(-5, 5);
    assert.ok(v >= -5 && v < 5, `out of range: ${v}`);
  }
});

test("pick() only ever returns members, and reaches all of them", () => {
  const rng = util.seededRand(21);
  const arr = ["a", "b", "c", "d"];
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const v = rng.pick(arr);
    assert.ok(arr.includes(v));
    seen.add(v);
  }
  assert.equal(seen.size, arr.length);
});

test("shuffle() permutes without mutating the source", () => {
  const rng = util.seededRand(64);
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = rng.shuffle(src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8], "source array must be untouched");
  assert.deepEqual([...out].sort((a, b) => a - b), src, "same multiset, reordered");
});

test("shuffle() is deterministic per seed", () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(util.seededRand(77).shuffle(src), util.seededRand(77).shuffle(src));
});

test("the distribution is broadly uniform (no obvious bias)", () => {
  const rng = util.seededRand(2024);
  const buckets = new Array(10).fill(0);
  const N = 100000;
  for (let i = 0; i < N; i++) buckets[Math.floor(rng() * 10)]++;
  for (const [i, n] of buckets.entries())
    assert.ok(Math.abs(n - N / 10) < N / 10 * 0.1, `bucket ${i} skewed: ${n}`);
});

test("seedFrom(): stable per string, and different strings differ", () => {
  assert.equal(util.seedFrom("2026-07-23"), util.seedFrom("2026-07-23"));
  assert.notEqual(util.seedFrom("2026-07-23"), util.seedFrom("2026-07-24"));
  assert.ok(Number.isInteger(util.seedFrom("x")) && util.seedFrom("x") >= 0);
});

test("the daily-challenge path: a date string yields one shared run", () => {
  const day = (d) => draw(util.seededRand(util.seedFrom(d)), 10);
  assert.deepEqual(day("2026-07-23"), day("2026-07-23"), "same day, same challenge everywhere");
  assert.notDeepEqual(day("2026-07-23"), day("2026-07-24"), "a new day should be a new challenge");
});

test("a default/zero seed still produces a usable stream", () => {
  const a = draw(util.seededRand());
  assert.equal(new Set(a).size, a.length, "no immediate repeats");
  assert.deepEqual(a, draw(util.seededRand(0)));
});
