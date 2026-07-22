# gamekit

Shared components for the family games ([WordVoyage](https://github.com/rvenning/wordvoyage),
[Chicken Cross](https://github.com/rvenning/chicken-cross), and whatever comes next).
Plain scripts, no build step — everything hangs off a single `GK` global.

**[▶ Play the demo](https://rvenning.github.io/gamekit/demo/)** — a tiny reflex game
that exercises every component; read its source as living documentation.

## What's in the box

| File | What it does |
|---|---|
| `gk/gk-util.js` | helpers: `esc`, `clamp`, `lerp`, `rand`, `pick`, `shade`, `hash2` |
| `gk/gk-audio.js` | `GK.Sfx` — WebAudio synth (`tone`, `noise`) + default `click/coin/win/lose/wrong`; games add their own jingles |
| `gk/gk-ui.js` | `GK.UI` — screens (`.screen` + `#screen-NAME`), modals (`.modal.visible`), toast, sound toggle |
| `gk/gk-storage.js` | `GK.createStorage(cfg)` — localStorage persistence + optional Firestore family sync (profiles, progress, tombstoned deletes; progress writes debounced, flushed on tab hide/close) |
| `gk/gk-profiles.js` | `GK.Profiles` — emoji-avatar roster, 4-digit PINs with admin override, type-name delete, leaderboard renderer; injects its own modals |
| `gk/gk-pwa.js` | `GK.initPWA()` — service-worker registration + Add-to-Home-Screen button (`beforeinstallprompt` on Chrome, instructions modal on iOS) |
| `gk/gk-fx.js` | `GK.Fx` — canvas juice: pooled particles (`burst`/`trail`/`dust`/`sparkle`/`splash`/`confetti`), screen shake, flash, floating text, lightning, slow-mo; plus `GK.Tween`. Per-game feel via `GK.Fx.configure({...})` |
| `gk/gk-base.css` | shared styles for all of the above, themed via `--gk-*` custom properties |
| `sw-template.js` | network-first service worker — copy to the game, set cache name + shell list |
| `manifest-template.json` | PWA manifest starter |
| `tools/png.js` | dependency-free PNG encoder + shape painter for generating PWA icons |
| `tools/sync-to-game.js` | vendors the kit into a game's `lib/` folder |

## How games consume it

Games **vendor a copy** (no CDN, no submodules): each game has a `lib/` folder that is
an exact copy of `gk/` plus `tools/png.js`, stamped with `lib/VERSION`. This keeps every
game self-contained (offline PWA caching keeps working) and makes kit updates deliberate —
a game only changes when you re-sync it and test.

```
# update a game to the current kit
node tools/sync-to-game.js "D:\OneDrive\Documents\Claude Code\chicken-cross"
# then test the game, bump its sw.js cache version, commit
```

## Wiring up a new game

Load order matters (each file extends `GK`):

```html
<link rel="stylesheet" href="lib/gk-base.css" />
<script src="lib/gk-util.js"></script>
<script src="lib/gk-audio.js"></script>
<script src="lib/gk-ui.js"></script>
<script src="lib/gk-storage.js"></script>
<script src="lib/gk-profiles.js"></script>
<script src="lib/gk-pwa.js"></script>
<script src="game.js"></script>
```

```js
// storage: pick a unique prefix + Firestore collection per game
const Storage = GK.createStorage({
  prefix: "mygame",
  collection: "mygame",           // add a matching rule in Firestore first!
  firebaseConfig: {...},          // same wordvoyage-e5a5c project, or null = offline-only
  blankProgress: () => ({ coins: 0, best: 0, levels: {}, updated: 0 }),
  mergeProgress: (a, b) => ({     // cross-device merge: keep the best of both
    coins: Math.max(a.coins||0, b.coins||0),
    best:  Math.max(a.best||0,  b.best||0),
    levels: /* per-level best */ {...},
  }),
});

// profiles + PIN + leaderboard
GK.Profiles.init({
  storage: Storage,
  avatars: ["🦊","🐼","🦄","🐸"],
  meta: (p, prog) => `🏁 best ${prog.best}`,
  onEnter: (p) => showMainMenu(p),
});
GK.Profiles.renderList();         // whenever the roster screen shows

// sounds: extend the defaults
Object.assign(GK.Sfx, { hop() { GK.Sfx.tone({ freq: 600, dur: 0.06 }); } });

// PWA (needs a #btn-install button, sw.js, manifest.json, icons/)
GK.initPWA({ appName: "My Game" });

// background sync; game is playable immediately
Storage.initFirebase().then(ok => badge.textContent = ok ? "☁️ synced" : "📴 offline");
```

New-game checklist:
1. Copy `demo/` as a starting skeleton, or wire up as above
2. `node tools/sync-to-game.js <game>` to vendor `lib/`
3. Copy `sw-template.js` → `sw.js` (set cache name + shell), `manifest-template.json` → `manifest.json`
4. Write an icon script against `lib/tools/png.js` (see the games' `tools/make-icons.js`)
5. Add a Firestore rule for the new collection in the
   [console](https://console.firebase.google.com/project/wordvoyage-e5a5c/firestore/rules)

## Firestore data model (per game collection)

- `profile_<id>` — `{ id, name, avatar, pin, created, updated }`
- `progress_<id>` — game-defined shape; must contain `updated`
- `deleted_<id>` — tombstone so removed profiles can't be resurrected by stale devices

### Auth

`gk-storage.js` signs in **anonymously** on boot, before touching Firestore, and
the rules require `request.auth != null`. The Firebase config is public in every
page load, so open rules meant anyone who viewed source could read or wipe the
family's progress. The anonymous uid is per-device and identifies nobody — it is
a gate against drive-by scripts, not an account, and players see no sign-in.

Sign-in failure is deliberately **not** fatal: if the Anonymous provider is ever
turned off, games log a warning and carry on, and it is the rules that decide
whether they can still sync.

The intended rules live in [`firestore.rules`](firestore.rules). That file is
documentation, not deployment — apply it in the Firebase console (Firestore
Database → Rules) or via `firebase deploy --only firestore:rules`.

**Rollout order matters.** Applying the rules before every game ships a build
with anonymous auth will silently drop those games to localStorage-only:

1. Enable Authentication → Sign-in method → **Anonymous** in the console.
2. Ship gamekit ≥ 1.3.0 to every game (re-vendor, deploy).
3. Only then apply the rules.

## Tests

Data-safety tests for the persistence/sync core (`gk-storage.js`) — the code
whose bugs would silently corrupt the kids' saved progress. No framework, just
Node's built-in runner:

```
cd gamekit && node --test        # or: npm test
```

`tests/storage.test.js` loads the real gk-* scripts in a `vm` sandbox with a
fake `localStorage` and a mock Firestore, and covers: tombstoned deletes (a
removed profile can't be resurrected by a stale device or a queued push), the
cross-device progress merge (keeps the best of each field, never drops an
unknown key), the newer-profile-wins rule, and the debounced write path (saves
coalesce and flush). The `mergeProgress` contract test also pins the "preserve
unknown keys" rule and the score-season (`sver`) reset pattern.

## Conventions the kit assumes

- Screens: `<div class="screen" id="screen-NAME">`, one `.active`
- Toast: `<div class="toast" id="toast">`
- Profile roster container: `<div id="profile-list">` (id configurable)
- Install button: `<button id="btn-install" style="display:none">`
- Admin PIN default `7777` (configurable via `GK.Profiles.init({ adminPin })`)
