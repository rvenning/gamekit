// gamekit · tools/sync-to-game.js — vendor the library into a game.
//
//   node tools/sync-to-game.js "D:\path\to\my-game"
//
// Copies gk/* and tools/png.js into <game>/lib/ and stamps lib/VERSION with
// the kit version + git commit, so each game records exactly what it ships.
// Games vendor a copy instead of loading from a CDN so they stay fully
// self-contained: offline PWA caching keeps working, and a kit update can
// never break a game until that game deliberately re-syncs and tests.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/sync-to-game.js "<game directory>"');
  process.exit(1);
}
if (!fs.existsSync(target)) {
  console.error("game directory not found:", target);
  process.exit(1);
}

const root = path.join(__dirname, "..");
const libDir = path.join(target, "lib");
fs.mkdirSync(path.join(libDir, "tools"), { recursive: true });

const copied = [];
for (const f of fs.readdirSync(path.join(root, "gk"))) {
  fs.copyFileSync(path.join(root, "gk", f), path.join(libDir, f));
  copied.push("lib/" + f);
}
// Vendored dev tools (not runtime, not in the SW shell): the PNG icon painter
// and the node --test harness. A game's tests require the harness from here.
for (const tool of ["png.js", "test-harness.js"]) {
  fs.copyFileSync(path.join(root, "tools", tool), path.join(libDir, "tools", tool));
  copied.push("lib/tools/" + tool);
}

const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); } catch {}
fs.writeFileSync(path.join(libDir, "VERSION"), `gamekit ${version} (${commit}) synced ${new Date().toISOString()}\n`);
copied.push("lib/VERSION");

console.log(`gamekit ${version} (${commit}) -> ${libDir}`);
for (const f of copied) console.log("  " + f);
