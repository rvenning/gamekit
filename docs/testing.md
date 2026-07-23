# Testing the family games

The games have no build step — they're plain `<script>` files hung off a
`window.GK` global. That shapes how they're tested. Two techniques carry most
of the weight, and both catch the failure mode that actually reaches the kids:
**shipped but broken, unfinishable, or not fun.** Neither is exotic; this doc
just writes them down so every game gets them cheaply.

Everything runs on Node's built-in runner, no dependencies:

```bash
cd <game> && node --test
```

---

## 1. The vm-loader harness

The game logic lives in browser scripts with top-level `const`, so you can't
just `require()` them. `tools/test-harness.js` (vendored into every game at
`lib/tools/test-harness.js`) runs them in a `vm` sandbox and hands back the
values you want to assert on.

### Pure data files → minimal sandbox

Level tables, dictionaries, grid packers — anything that doesn't touch the DOM
or `localStorage`. Name the top-level bindings you want back:

```js
const { loadScripts } = require("../lib/tools/test-harness.js");

const { LEVELS, buildGrid } = loadScripts({
  baseDir: __dirname + "/../js",
  files: ["levels.js", "grid.js"],   // concatenated, so grid.js sees levels.js
  exports: ["LEVELS", "buildGrid"],
});
```

Files are concatenated and run as **one** program on purpose: a `const` in
`levels.js` wouldn't be visible to `grid.js` if they ran separately.

### `gk-*` scripts → browser sandbox

Anything that reaches for `window`, `localStorage`, `document`, or
`matchMedia`. Pass `browser: true`; the scripts hang themselves off `window.GK`,
so read that back instead of naming exports:

```js
const GK = loadScripts({
  baseDir: __dirname + "/../lib",
  files: ["gk-util.js", "gk-storage.js"],
  browser: true,
}).GK;
```

The browser sandbox fakes a self-referential `window`, an in-memory
`localStorage`, a no-op `document`/event surface, `matchMedia` (default: no
match — pass `matchMedia: true` to force reduced-motion queries on), and an
`unref`'d `setTimeout` so a pending debounce timer can't keep the test runner
alive. `globals: {…}` merges in anything else a test needs.

`gamekit/tests/storage.test.js` and `fx.test.js` use this; copy their shape.

---

## 2. Data linters

A test that loops every shipped level and asserts the invariants **is** a data
linter — a typo'd word or a malformed level fails at commit time instead of in
a kid's hands. Collect all failures and assert the list is empty, so one run
surfaces every offending level rather than stopping at the first:

```js
const fails = [];
LEVELS.forEach((lv, i) => { /* push a message per problem */ });
assert.deepEqual(fails, []);
```

The strongest of these check **reachability**, not just shape. Brick Breaker's
`tests/levels.test.js` runs a BFS from outside each layout — empty cells and
destructible bricks are passable, steel and portals are not — and fails any
scoring brick sealed behind indestructible ones. A level that *parses* fine can
still be impossible to finish; only the flood-fill catches it. WordVoyage's
`grid.test.js` does the connected-component version for crosswords.

---

## 3. The headless balance bot

Static linters prove a level is *valid*. They can't prove it's *finishable in a
reasonable time* or *not a runaway*. For that, drive the real engine headlessly
with a perfect-input bot and assert on the outcome:

```js
// sketch — the bot is game-specific and stays in the game repo
const { Game, Ball } = loadGame();
Game.start(profile, levelIndex);
let frames = 0;
while (Game.running && frames < 60 * 600) {   // 10-minute safety cap
  Game.aimPaddleAt(Ball.x);                    // perfect tracking, no misses
  Game.update(1 / 60, 1 / 60);                 // dt, realDt
  frames++;
}
assert.ok(!Game.running === false || Game.won, "level should be winnable");
assert.ok(frames < 60 * 180, `level took ${frames / 60}s — too grindy`);
```

Run over every level, this asserts a **completion-time band** (an upper bound
catches grind and unwinnable layouts; a lower bound catches trivial ones) and a
**score band** (catches runaway scoring). On the Brick Breaker DX build this
one pattern caught, before release:

- a boss that took **~6 minutes** even with perfect play,
- a level whose bricks **chain-detonated for ~10× the intended score**,
- a layout that was simply **uncompletable**.

None of those are visible to a static test — they only show up when something
actually plays the level to the end.

### Keeping it deterministic

- Seed or stub anything random (`Math.random`, power-up drops) so a failure
  reproduces. `matchMedia`/timers are already inert under the harness.
- Feed a **fixed timestep** (`1/60`), not wall-clock, so the sim is
  frame-rate-independent and fast.
- Pass a throwaway in-memory profile and stub persistence — a balance run must
  never touch a real player's save or Firestore. (See the notes in
  `gamekit/tests/storage.test.js` on the browser sandbox's fake `localStorage`.)

The bot stays in each game's `tests/` because "perfect input" means something
different per game — track the ball, spell the highest-scoring word, take the
safe lane. The harness and the linter patterns above are the shared parts; this
is the game-specific glue that makes them pay off.
