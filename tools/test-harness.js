// gamekit · tools/test-harness.js — load no-build browser scripts into
// `node --test`.
//
// The games ship plain <script> files with top-level `const`, no bundler. To
// test their logic in Node we run the source in a vm sandbox with a faked
// browser, then read back the values we want to assert on. Every game suite
// had copied the same ~15 lines of boilerplate; this is that boilerplate,
// once.
//
//   const { loadScripts } = require("../lib/tools/test-harness.js");
//
//   // pure data files (no window/localStorage) -> minimal sandbox:
//   const { LEVELS, buildGrid } = loadScripts({
//     baseDir: __dirname + "/../js",
//     files: ["levels.js", "grid.js"],
//     exports: ["LEVELS", "buildGrid"],
//   });
//
//   // gk-* scripts that touch window/localStorage/document -> browser sandbox:
//   const GK = loadScripts({
//     baseDir: __dirname + "/../lib",
//     files: ["gk-util.js", "gk-storage.js"],
//     browser: true,
//   }).GK;
//
// Why concat-and-run-once: separate runInContext calls don't share a lexical
// scope, so a `const` in levels.js wouldn't be visible to grid.js. The files
// are joined into ONE program and run together, then a trailing line copies
// the named bindings onto the sandbox so the test can reach them.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// In-memory localStorage for scripts that persist (gk-storage etc.).
function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

// Minimal MediaQueryList stub — enough for `matchMedia("...").matches` and the
// add/removeEventListener calls reduced-motion code makes. Defaults to no match.
function makeMatchMedia(matches = false) {
  return (query) => ({
    matches, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
}

// Build a fresh sandbox. `browser:true` fakes just enough of the DOM/runtime
// that gk-* scripts load and run: a self-referential `window`, localStorage, a
// no-op document/event surface, matchMedia, and setTimeout unref'd so a pending
// debounce timer can't keep `node --test` alive. `globals` merges in anything
// a specific test needs on top.
function makeSandbox({ browser = false, matchMedia = false, globals = {} } = {}) {
  const sandbox = { console };
  if (browser) {
    sandbox.localStorage = makeLocalStorage();
    sandbox.document = {
      addEventListener() {}, removeEventListener() {},
      visibilityState: "visible", hidden: false,
    };
    sandbox.setTimeout = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; };
    sandbox.clearTimeout = clearTimeout;
    sandbox.addEventListener = () => {};
    sandbox.removeEventListener = () => {};
    sandbox.matchMedia = makeMatchMedia(matchMedia);
    sandbox.window = sandbox;   // scripts do `window.GK = window.GK || {}`
  }
  Object.assign(sandbox, globals);
  vm.createContext(sandbox);
  return sandbox;
}

// Load one or more browser scripts as a single program and return the named
// exports (or the whole sandbox if `exports` is omitted — handy for the GK
// global, which the scripts hang off `window` themselves).
function loadScripts({ files, exports = [], baseDir = process.cwd(),
                       browser = false, matchMedia = false, globals = {},
                       filename = "gk-test-bundle.js" } = {}) {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error("loadScripts: `files` must be a non-empty array");
  const sandbox = makeSandbox({ browser, matchMedia, globals });
  const body = files
    .map((f) => fs.readFileSync(path.resolve(baseDir, f), "utf8"))
    .join("\n");
  // `globalThis` inside the context IS the sandbox, so this copies the
  // top-level bindings onto it for the test to read.
  const tail = exports.length
    ? `\n;globalThis.__EXPORTS__ = { ${exports.join(", ")} };`
    : "";
  vm.runInContext(body + tail, sandbox, { filename });
  return exports.length ? sandbox.__EXPORTS__ : sandbox;
}

module.exports = { loadScripts, makeSandbox, makeLocalStorage, makeMatchMedia };
