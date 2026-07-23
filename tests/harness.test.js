"use strict";
// Tests for the test harness itself. If loadScripts regresses, every game
// suite that leans on it goes red at once with a confusing message, so the
// harness earns its own coverage.
//
//   cd gamekit && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadScripts, makeSandbox, makeLocalStorage, makeMatchMedia } = require("../tools/test-harness.js");

const GK_DIR = path.join(__dirname, "..", "gk");

// Write throwaway browser-script fixtures to a temp dir.
function fixtures(map) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gk-harness-"));
  for (const [name, src] of Object.entries(map)) fs.writeFileSync(path.join(dir, name), src);
  return dir;
}

test("named exports come back from a top-level const", () => {
  const dir = fixtures({ "data.js": "const ANSWER = 42; const NAME = 'voyage';" });
  const { ANSWER, NAME } = loadScripts({ baseDir: dir, files: ["data.js"], exports: ["ANSWER", "NAME"] });
  assert.equal(ANSWER, 42);
  assert.equal(NAME, "voyage");
});

test("concatenated files share one lexical scope", () => {
  // The whole point: a `const` in the first file must be visible to the second.
  const dir = fixtures({
    "a.js": "const BASE = 10;",
    "b.js": "const DOUBLED = BASE * 2;",
  });
  const { DOUBLED } = loadScripts({ baseDir: dir, files: ["a.js", "b.js"], exports: ["DOUBLED"] });
  assert.equal(DOUBLED, 20);
});

test("each load is isolated — no state bleeds between calls", () => {
  const dir = fixtures({ "counter.js": "if (!globalThis.hits) globalThis.hits = 0; globalThis.hits++;" });
  const a = loadScripts({ baseDir: dir, files: ["counter.js"] });
  const b = loadScripts({ baseDir: dir, files: ["counter.js"] });
  assert.equal(a.hits, 1);
  assert.equal(b.hits, 1, "a fresh sandbox should start from zero");
});

test("minimal sandbox has no window (pure data files don't need one)", () => {
  const dir = fixtures({ "x.js": "const HAS_WINDOW = typeof window !== 'undefined';" });
  const { HAS_WINDOW } = loadScripts({ baseDir: dir, files: ["x.js"], exports: ["HAS_WINDOW"] });
  assert.equal(HAS_WINDOW, false);
});

test("browser sandbox fakes window/localStorage/matchMedia for gk-* scripts", () => {
  const dir = fixtures({
    "probe.js": `window.__probe = {
      hasWindow: window === globalThis,
      canPersist: (localStorage.setItem('k','v'), localStorage.getItem('k') === 'v'),
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };`,
  });
  const sandbox = loadScripts({ baseDir: dir, files: ["probe.js"], browser: true });
  assert.deepEqual(sandbox.__probe, { hasWindow: true, canPersist: true, reduced: false });
});

test("matchMedia:true makes reduced-motion queries match", () => {
  const dir = fixtures({ "m.js": "window.__m = matchMedia('(prefers-reduced-motion: reduce)').matches;" });
  const sandbox = loadScripts({ baseDir: dir, files: ["m.js"], browser: true, matchMedia: true });
  assert.equal(sandbox.__m, true);
});

test("globals are injected into the sandbox", () => {
  const dir = fixtures({ "g.js": "const SEEN = INJECTED + 1;" });
  const { SEEN } = loadScripts({ baseDir: dir, files: ["g.js"], exports: ["SEEN"], globals: { INJECTED: 41 } });
  assert.equal(SEEN, 42);
});

test("loads the real gk-util.js and its helpers work", () => {
  // End-to-end against a shipped module, not just fixtures.
  const GK = loadScripts({ baseDir: GK_DIR, files: ["gk-util.js"], browser: true }).GK;
  assert.equal(GK.util.clamp(15, 0, 10), 10);
  assert.equal(GK.util.lerp(0, 100, 0.25), 25);
});

test("an empty file list is rejected", () => {
  assert.throws(() => loadScripts({ baseDir: GK_DIR, files: [] }), /non-empty array/);
});

test("makeLocalStorage behaves like the Web Storage it stands in for", () => {
  const ls = makeLocalStorage();
  assert.equal(ls.length, 0);
  ls.setItem("a", 1);            // coerces to string like the real thing
  assert.equal(ls.getItem("a"), "1");
  assert.equal(ls.length, 1);
  ls.removeItem("a");
  assert.equal(ls.getItem("a"), null);
});

test("makeMatchMedia reports the requested match state and is inert", () => {
  const mm = makeMatchMedia(true)("(min-width: 600px)");
  assert.equal(mm.matches, true);
  assert.equal(mm.media, "(min-width: 600px)");
  assert.doesNotThrow(() => { mm.addEventListener("change", () => {}); mm.removeEventListener("change", () => {}); });
});

test("makeSandbox returns a live vm context", () => {
  const sandbox = makeSandbox({ globals: { SEED: 7 } });
  assert.equal(sandbox.SEED, 7);
  assert.equal(typeof sandbox.console, "object");
});
