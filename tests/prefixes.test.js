"use strict";
// Every family game is served from https://rvenning.github.io — the SAME
// origin, with only the path differing. localStorage is scoped to the origin,
// so two games sharing a `prefix` share one profile roster and one set of
// progress keys, and whichever is played second overwrites the first's saves.
//
// Critter Clash shipped with prefix "cc", which is Chicken Cross's. It was
// caught before anyone played it, because the new game showed the old game's
// profiles and level data. This test is the thing that should have caught it.
//
//   cd gamekit && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// The games live as siblings of the gamekit folder.
const GAMES_DIR = path.join(__dirname, "..", "..");

function readConfigs() {
  const out = [];
  for (const name of fs.readdirSync(GAMES_DIR)) {
    const dir = path.join(GAMES_DIR, name);
    if (name === "gamekit" || !fs.statSync(dir).isDirectory()) continue;
    // A game is any folder with an index.html that calls createStorage.
    const files = [];
    for (const f of ["index.html", "js/storage.js", "js/main.js"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) files.push(fs.readFileSync(p, "utf8"));
    }
    if (!files.length) continue;
    const src = files.join("\n");
    if (!src.includes("createStorage")) continue;
    const prefix = /prefix:\s*"([^"]+)"/.exec(src);
    const collection = /collection:\s*"([^"]+)"/.exec(src);
    out.push({ name, prefix: prefix && prefix[1], collection: collection && collection[1] });
  }
  return out;
}

const GAMES = readConfigs();

test("the scan found the games (a silent zero would make this suite useless)", () => {
  assert.ok(GAMES.length >= 5, `only found ${GAMES.length} games: ${GAMES.map(g => g.name)}`);
});

test("every game declares a storage prefix and a Firestore collection", () => {
  const missing = GAMES.filter(g => !g.prefix || !g.collection)
    .map(g => `${g.name}: prefix=${g.prefix} collection=${g.collection}`);
  assert.deepEqual(missing, []);
});

test("no two games share a localStorage prefix", () => {
  const seen = new Map(), clashes = [];
  for (const g of GAMES) {
    if (seen.has(g.prefix)) clashes.push(`"${g.prefix}" used by both ${seen.get(g.prefix)} and ${g.name}`);
    else seen.set(g.prefix, g.name);
  }
  assert.deepEqual(clashes, [],
    "same origin + same prefix = one game silently overwriting another's saves");
});

test("no two games share a Firestore collection", () => {
  const seen = new Map(), clashes = [];
  for (const g of GAMES) {
    if (seen.has(g.collection)) clashes.push(`"${g.collection}" used by both ${seen.get(g.collection)} and ${g.name}`);
    else seen.set(g.collection, g.name);
  }
  assert.deepEqual(clashes, []);
});
