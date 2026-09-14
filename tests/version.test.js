"use strict";
// Tests for tools/stamp-version.js and GK.Version (gk-pwa.js): the version a
// game shows on its home screen, and the "is this the latest?" check.
//
//   cd gamekit && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadScripts } = require("../tools/test-harness.js");
const { stamp } = require("../tools/stamp-version.js");

const GK_DIR = path.join(__dirname, "..", "gk");

function fakeGame({ html = '<!DOCTYPE html>\n<html><head>\n<meta charset="UTF-8">\n<title>x</title>\n</head></html>\n', kit = "gamekit 1.10.0 (abc1234) synced 2026-09-14T00:00:00Z\n" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gk-version-"));
  fs.writeFileSync(path.join(dir, "sw.js"), 'const CACHE = "my-game-v7"; // bump\nconst SHELL = [];\n');
  fs.writeFileSync(path.join(dir, "index.html"), html);
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "VERSION"), kit);
  return dir;
}

test("stamp reads the version from the service-worker cache name", () => {
  const dir = fakeGame();
  const info = stamp(dir, { date: "2026-09-14" });
  assert.deepEqual(info, { game: "my-game", version: 7, date: "2026-09-14", kit: "1.10.0" });
  assert.match(fs.readFileSync(path.join(dir, "sw.js"), "utf8"), /"my-game-v7"/);
});

test("--bump increments the cache name and writes the same number everywhere", () => {
  const dir = fakeGame();
  stamp(dir, { bump: true, date: "2026-09-14" });
  assert.match(fs.readFileSync(path.join(dir, "sw.js"), "utf8"), /const CACHE = "my-game-v8"; \/\/ bump/);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(html, /<meta charset="UTF-8">\n<meta name="gk-version" content="8" data-date="2026-09-14" data-kit="1.10.0">/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "version.json"), "utf8")), { game: "my-game", version: 8, date: "2026-09-14", kit: "1.10.0" });
});

test("stamping again replaces the meta tag instead of adding another", () => {
  const dir = fakeGame();
  stamp(dir, { bump: true, date: "2026-09-14" });
  stamp(dir, { bump: true, date: "2026-09-15" });
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.equal(html.match(/gk-version/g).length, 1);
  assert.match(html, /content="9" data-date="2026-09-15"/);
});

test("a cache name without -vN is an error, not a silent guess", () => {
  const dir = fakeGame();
  fs.writeFileSync(path.join(dir, "sw.js"), 'const CACHE = "mygame";\n');
  assert.throws(() => stamp(dir), /no CACHE name ending in -vN/);
});

// ---- GK.Version in a faked browser ----

function fakeDom(metaAttrs) {
  const mk = (tag) => {
    const el = {
      tag, className: "", title: "", textContent: "", children: [], attrs: {}, listeners: {},
      classList: { list: [], add(c) { this.list.push(c); } },
      setAttribute(k, v) { el.attrs[k] = v; },
      getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
      append(...c) { el.children.push(...c); },
      appendChild(c) { el.children.push(c); return c; },
      replaceChildren(...c) { el.children = c; el.textContent = ""; },
      addEventListener(t, fn) { el.listeners[t] = fn; },
    };
    return el;
  };
  const meta = metaAttrs ? Object.assign(mk("meta"), { attrs: metaAttrs }) : null;
  const screen = mk("div");
  return {
    screen,
    document: {
      createElement: mk,
      getElementById: () => null,
      querySelector: (sel) => (sel.startsWith("meta") ? meta : sel === ".screen.active" ? screen : null),
      body: mk("body"),
    },
  };
}

function loadVersion({ metaAttrs, deployed, online = true }) {
  const dom = fakeDom(metaAttrs);
  const GK = loadScripts({
    baseDir: GK_DIR,
    files: ["gk-util.js", "gk-pwa.js"],
    browser: true,
    globals: {
      document: dom.document,
      navigator: { onLine: online },
      fetch: async () => (deployed ? { ok: true, json: async () => deployed } : { ok: false }),
    },
  }).GK;
  return { GK, dom };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test("label reads like 'Version 12 · 14 Sep 2026'", () => {
  const { GK } = loadVersion({});
  assert.equal(GK.Version.label({ version: 12, date: "2026-09-14" }), "Version 12 · 14 Sep 2026");
  assert.equal(GK.Version.label({ version: 3, date: "" }), "Version 3");
});

test("an unstamped game shows nothing", () => {
  const { GK, dom } = loadVersion({});
  assert.equal(GK.Version.mount(), null);
  assert.equal(dom.screen.children.length, 0);
});

test("mounts on the active screen and says Latest when the deployed build matches", async () => {
  const { GK, dom } = loadVersion({ metaAttrs: { content: "8", "data-date": "2026-09-14", "data-kit": "1.10.0" }, deployed: { version: 8 } });
  const el = GK.Version.mount();
  assert.equal(dom.screen.children[0], el);
  assert.equal(el.children[0].textContent, "Version 8 · 14 Sep 2026");
  await flush(); await flush();
  assert.equal(el.children[1].textContent, "✓ Latest");
});

test("offers an update when a newer build is deployed", async () => {
  const { GK } = loadVersion({ metaAttrs: { content: "8", "data-date": "2026-09-14" }, deployed: { version: 9 } });
  const el = GK.Version.mount();
  await flush(); await flush();
  const btn = el.children[1].children[0];
  assert.equal(btn.textContent, "Update to 9");
});

test("offline, it shows the version and no verdict", async () => {
  const { GK } = loadVersion({ metaAttrs: { content: "8", "data-date": "2026-09-14" }, deployed: { version: 9 }, online: false });
  const el = GK.Version.mount();
  await flush(); await flush();
  assert.equal(el.children[1].textContent, "");
  assert.equal(el.children[1].children.length, 0);
});
