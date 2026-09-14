// gamekit · tools/stamp-version.js — give a game its version number.
//
//   node lib/tools/stamp-version.js <game dir> [--bump]
//
// A game's version is the number on its service-worker cache name
// (`const CACHE = "mygame-v12"` -> 12). Deploying means bumping that number so
// installed copies refresh; --bump does it. Then the version is written to:
//
//   index.html    <meta name="gk-version" content="12" data-date=... data-kit=...>
//                 the build the page was loaded from (GK.Version.running)
//   version.json  {"game","version","date","kit"}
//                 the build that is deployed (GK.Version.fetchLatest)
//
// GK.initPWA() shows "Version 12 · 14 Sep 2026" on the home screen, with
// "✓ Latest" or an Update button. Run it as the last step before committing a
// deploy, instead of editing sw.js by hand.

const fs = require("fs");
const path = require("path");

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stamp(gameDir, { bump = false, date = localDate() } = {}) {
  const swPath = path.join(gameDir, "sw.js");
  const htmlPath = path.join(gameDir, "index.html");
  let sw = fs.readFileSync(swPath, "utf8");
  const m = /(const\s+CACHE\s*=\s*["'])([^"']*?)-v(\d+)(["'])/.exec(sw);
  if (!m) throw new Error(`${swPath}: no CACHE name ending in -vN`);
  const game = m[2];
  let version = Number(m[3]);
  if (bump) {
    version++;
    sw = sw.replace(m[0], `${m[1]}${game}-v${version}${m[4]}`);
    fs.writeFileSync(swPath, sw);
  }

  let kit = "";
  try { kit = fs.readFileSync(path.join(gameDir, "lib", "VERSION"), "utf8").split(/\s+/)[1] || ""; } catch {}

  const meta = `<meta name="gk-version" content="${version}" data-date="${date}" data-kit="${kit}">`;
  let html = fs.readFileSync(htmlPath, "utf8");
  if (/<meta name="gk-version"[^>]*>/.test(html)) html = html.replace(/<meta name="gk-version"[^>]*>/, meta);
  else if (/<meta charset[^>]*>/i.test(html)) html = html.replace(/(<meta charset[^>]*>)/i, `$1\n${meta}`);
  else throw new Error(`${htmlPath}: no <meta charset> to put the version after`);
  fs.writeFileSync(htmlPath, html);

  const info = { game, version, date, kit };
  fs.writeFileSync(path.join(gameDir, "version.json"), JSON.stringify(info) + "\n");
  return info;
}

module.exports = { stamp };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("usage: node lib/tools/stamp-version.js <game dir> [--bump]");
    process.exit(1);
  }
  const info = stamp(dir, { bump: args.includes("--bump") });
  console.log(`${info.game}: version ${info.version} (${info.date}, gamekit ${info.kit || "?"})`);
}
