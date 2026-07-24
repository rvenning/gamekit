"use strict";
// Tests for gk-debug.js. The one that really matters is the safety rule:
// while debug is on, progress writes must be suppressed. Family sync merges
// by MAX, so a score inflated by a debug session would be permanent on every
// device — a bug here quietly corrupts the kids' saves.
//
//   cd gamekit && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../tools/test-harness.js");

const GK_DIR = path.join(__dirname, "..", "gk");

// Enough of a DOM that init() can build its panel. We assert on behaviour
// (flags, suppressed writes, fps), not on the markup — the panel itself is
// verified in the browser.
function fakeDocument() {
  const mk = () => {
    const el = {
      className: "", id: "", textContent: "", innerHTML: "", value: "",
      style: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(c) { el.children.push(c); return c; },
      append(...c) { el.children.push(...c); },
      querySelector: () => mk(),
      querySelectorAll: () => [],
      setAttribute() {}, addEventListener() {},
    };
    return el;
  };
  return {
    createElement: mk, getElementById: () => null,
    head: mk(), body: mk(),
    addEventListener() {}, visibilityState: "visible",
  };
}

function loadDebug({ debug = false } = {}) {
  return loadScripts({
    baseDir: GK_DIR,
    files: ["gk-util.js", "gk-debug.js"],
    browser: true,
    globals: {
      location: { search: debug ? "?debug=1" : "" },
      document: fakeDocument(),
      URLSearchParams,
    },
  }).GK.Debug;
}

test("off unless the URL says ?debug=1", () => {
  assert.equal(loadDebug().on, false);
  assert.equal(loadDebug({ debug: true }).on, true);
});

test("a missing/odd location can't crash the module", () => {
  const GK = loadScripts({
    baseDir: GK_DIR, files: ["gk-util.js", "gk-debug.js"], browser: true,
    globals: { document: fakeDocument(), URLSearchParams },   // no `location` at all
  }).GK;
  assert.equal(GK.Debug.on, false, "should fail closed, not throw");
});

test("every method is a safe no-op when debug is off", () => {
  const D = loadDebug();
  assert.doesNotThrow(() => {
    D.init({ storage: {} });
    D.toggle("x", "x", true);
    D.action("a", () => { throw new Error("must not run"); });
    D.jump("level", 10, () => { throw new Error("must not run"); });
    D.note("hi");
    D.frame(1 / 60);
  });
  assert.equal(D.flag("x"), false, "flags stay false so game code can call flag() freely");
  assert.deepEqual(D.flags, {}, "no flags registered while off");
});

test("SAFETY: debug mode suppresses progress writes", () => {
  const D = loadDebug({ debug: true });
  let writes = 0;
  const storage = { saveProgress: () => { writes++; } };
  D.init({ storage });
  storage.saveProgress("profile", { best: 9999 });
  storage.saveProgress("profile", { best: 9999 });
  assert.equal(writes, 0, "a debug session must never persist progress");
});

test("without debug, the real saveProgress is untouched", () => {
  const D = loadDebug();                     // debug off
  let writes = 0;
  const storage = { saveProgress: () => { writes++; } };
  D.init({ storage });
  storage.saveProgress("profile", { best: 10 });
  assert.equal(writes, 1, "normal play must still save");
});

test("init without a storage object doesn't throw", () => {
  const D = loadDebug({ debug: true });
  assert.doesNotThrow(() => D.init());
});

test("init is idempotent — a second call doesn't rebuild or re-wrap", () => {
  const D = loadDebug({ debug: true });
  let writes = 0;
  const storage = { saveProgress: () => { writes++; } };
  D.init({ storage });
  D.init({ storage });
  storage.saveProgress();
  assert.equal(writes, 0);
});

test("toggles register a readable flag with the requested initial state", () => {
  const D = loadDebug({ debug: true });
  D.init();
  D.toggle("hitboxes", "hitboxes");
  D.toggle("invincible", "invincible", true);
  assert.equal(D.flag("hitboxes"), false);
  assert.equal(D.flag("invincible"), true);
  assert.equal(D.flag("never-registered"), false);
});

test("frame() computes fps once enough time has passed", () => {
  const D = loadDebug({ debug: true });
  D.init();
  assert.equal(D.fps, 0);
  // One frame past the 0.5s sampling window: 30/60ths sums to just under 0.5
  // in floating point, so the readout would land a frame later. The rate is
  // what matters here, not the exact frame it refreshes on.
  for (let i = 0; i < 31; i++) D.frame(1 / 60);
  assert.equal(D.fps, 60);
  for (let i = 0; i < 16; i++) D.frame(1 / 30);
  assert.equal(D.fps, 30);
});

test("the builder methods chain", () => {
  const D = loadDebug({ debug: true });
  assert.equal(D.init().toggle("a", "a").action("b", () => {}).jump("lvl", 5, () => {}), D);
});
