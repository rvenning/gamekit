"use strict";
// Behaviour tests for gk-path.js — waypoint-authored levels.
//
// Nothing here can corrupt a save, but a bug in this module ships an
// unplayable level: a route that walks off the board, a corridor that pinches
// shut, or a pickup placed inside solid rock. The lint helpers are the point of
// the module, so most of these assert that a deliberately broken level is
// CAUGHT — a linter that passes everything is worse than none.
//
//   cd gamekit && node --test
//
// gk-path.js is a browser script hanging off a `window.GK` global, so it runs
// in a vm sandbox.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../tools/test-harness.js");

const GK_DIR = path.join(__dirname, "..", "gk");
const GK = loadScripts({ baseDir: GK_DIR, files: ["gk-util.js", "gk-path.js"], browser: true }).GK;

/* ================================================================= Route */

// Turret Town's first map, verbatim.
const ROAD = [[4, -1], [4, 3], [8, 3], [8, 8], [2, 8], [2, 12], [7, 12], [7, 14]];

test("a route's length is the sum of its legs", () => {
  const r = GK.Route.make(ROAD, { offset: 0.5 });
  assert.equal(r.len, 4 + 4 + 5 + 6 + 4 + 5 + 2);
});

test("walking a route clamps at both ends instead of running off it", () => {
  const r = GK.Route.make(ROAD, { offset: 0.5 });
  assert.deepEqual(r.at(-50), { x: 4.5, y: -0.5 }, "before the start is the start");
  assert.deepEqual(r.at(0), { x: 4.5, y: -0.5 });
  assert.deepEqual(r.at(r.len), { x: 7.5, y: 14.5 });
  assert.deepEqual(r.at(r.len + 999), { x: 7.5, y: 14.5 }, "past the end is the end");
});

test("a route passes through its own corners at the right distances", () => {
  const r = GK.Route.make(ROAD, { offset: 0.5 });
  // 4 along the first leg is the first corner; 8 is the second.
  assert.deepEqual(r.at(4), { x: 4.5, y: 3.5 });
  assert.deepEqual(r.at(8), { x: 8.5, y: 3.5 });
  assert.deepEqual(r.at(2), { x: 4.5, y: 1.5 }, "halfway down the first leg");
});

test("progress runs 0 to 1 and never leaves it", () => {
  const r = GK.Route.make(ROAD, { offset: 0.5 });
  assert.equal(r.progress(0), 0);
  assert.equal(r.progress(r.len), 1);
  assert.equal(r.progress(r.len * 2), 1);
  assert.equal(r.progress(-5), 0);
});

test("the heading points along the leg you are on", () => {
  const r = GK.Route.make(ROAD, { offset: 0.5 });
  assert.deepEqual(r.dirAt(1), { x: 0, y: 1 }, "first leg runs down the board");
  assert.deepEqual(r.dirAt(6), { x: 1, y: 0 }, "second leg runs right");
  assert.deepEqual(r.dirAt(11), { x: 0, y: 1 });
});

test("route cells cover every square the road touches, corners included", () => {
  const cells = GK.Route.cells([[0, 0], [3, 0], [3, 2]]);
  assert.deepEqual([...cells].sort(),
    ["0,0", "1,0", "2,0", "3,0", "3,1", "3,2"].sort());
  // Turret Town's real map: an 8-leg road should be a connected run of cells.
  assert.ok(GK.Route.cells(ROAD).size > 25);
});

/* ----------------------------------------------------------- Route.lint */

test("a good route lints clean", () => {
  assert.deepEqual(
    GK.Route.lint(ROAD, { bounds: { w: 10, h: 14 }, minCells: 20 }), []);
});

test("the route linter catches a diagonal or zero-length leg", () => {
  assert.match(GK.Route.lint([[0, -1], [3, 4], [3, 14]])[0], /diagonal/);
  assert.match(GK.Route.lint([[0, -1], [0, -1], [0, 14]])[0], /no length/);
});

test("the route linter insists things enter and leave the frame", () => {
  const inside = GK.Route.lint([[2, 2], [2, 8], [7, 8], [7, 14]], { bounds: { w: 10, h: 14 } });
  assert.ok(inside.some((m) => /start OFF the board/.test(m)));
  const corner = GK.Route.lint([[2, -1], [2, 20], [7, 20], [7, 14]], { bounds: { w: 10, h: 14 } });
  assert.ok(corner.some((m) => /corner 1 \(2,20\) is off the board/.test(m)));
});

test("the route linter catches a road that doubles back over itself", () => {
  // out to x=6 and straight back along the same row
  const fails = GK.Route.lint([[0, -1], [0, 3], [6, 3], [6, 5], [0, 5], [0, 3], [0, 14]]);
  assert.ok(fails.some((m) => /crosses itself/.test(m)), fails.join(" | "));
});

test("a linter that passes everything is worse than none — it reports EVERY offender", () => {
  const fails = GK.Route.lint([[0, -1], [3, 4], [8, 9]], { label: "bad" });
  assert.equal(fails.length, 2, "both diagonal legs, not just the first");
  assert.ok(fails.every((m) => m.startsWith("bad: ")));
});

/* ============================================================== Corridor */

// Rocket Rescue's first cave, verbatim.
const CAVE = [[0, 112, 120], [800, 84, 112], [1600, 140, 110], [2400, 80, 112],
              [3100, 142, 116], [3700, 112, 120]];

test("a corridor reproduces its stations exactly", () => {
  const c = GK.Corridor.make(CAVE);
  for (const [x, centre, width] of CAVE) {
    const s = c.sample(x);
    assert.ok(Math.abs(s.c - centre) < 1e-9, `centre at x=${x}`);
    assert.ok(Math.abs(s.w - width) < 1e-9, `width at x=${x}`);
  }
});

test("sampling outside the authored range holds the end stations", () => {
  const c = GK.Corridor.make(CAVE);
  assert.deepEqual(c.sample(-5000), { c: 112, w: 120 });
  assert.deepEqual(c.sample(99999), { c: 112, w: 120 });
});

test("smoothstep leaves no kink at a station, linear does", () => {
  const stations = [[0, 0, 10], [100, 100, 10], [200, 100, 10]];
  const grad = (c, x) => (c.centreAt(x + 1) - c.centreAt(x - 1)) / 2;
  const smooth = GK.Corridor.make(stations);
  const linear = GK.Corridor.make(stations, { ease: "linear" });
  // Approaching x=100 the centre stops climbing; smoothstep eases to zero,
  // linear slams from 1 to 0.
  assert.ok(Math.abs(grad(smooth, 100)) < 0.05, "smooth is flat at the station");
  assert.ok(Math.abs(grad(linear, 99)) > 0.9, "linear is still at full tilt");
});

test("the walls are always half a width either side of the centre", () => {
  const c = GK.Corridor.make(CAVE);
  for (let x = 0; x <= 3700; x += 37) {
    const s = c.sample(x);
    assert.ok(Math.abs(c.lowAt(x) - (s.c - s.w / 2)) < 1e-9);
    assert.ok(Math.abs(c.highAt(x) - (s.c + s.w / 2)) < 1e-9);
    assert.ok(c.highAt(x) > c.lowAt(x));
  }
});

// The reason the module exists: authored content cannot land inside geometry.
test("place() never lands outside the passage, at any fraction", () => {
  const c = GK.Corridor.make(CAVE);
  const CLEAR = 15.6;
  for (let x = 0; x <= 3700; x += 23) {
    for (const t of [-1, 0, 0.14, 0.5, 0.86, 1, 2]) {
      const y = c.place(x, t, CLEAR);
      assert.ok(y >= c.lowAt(x) + CLEAR - 1e-9 && y <= c.highAt(x) - CLEAR + 1e-9,
        `t=${t} at x=${x} placed ${y} outside [${c.lowAt(x)}, ${c.highAt(x)}]`);
    }
  }
});

test("place() centres content when the passage is too tight for the clearance", () => {
  const c = GK.Corridor.make([[0, 100, 10], [100, 100, 10]]);
  assert.equal(c.place(50, 0, 40), 100, "no room for the margin: centre it rather than invert");
});

test("place(0.5) is the centre line, and the fraction runs low to high", () => {
  const c = GK.Corridor.make(CAVE);
  assert.ok(Math.abs(c.place(1200, 0.5) - c.centreAt(1200)) < 1e-9);
  assert.ok(c.place(1200, 0.1) < c.place(1200, 0.9));
});

test("minWidth finds a pinch BETWEEN two stations, not just at them", () => {
  // Both stations are 100 wide; the interpolation dips nowhere — but with a
  // third station mid-way the minimum is only visible if you sample.
  const c = GK.Corridor.make([[0, 100, 100], [500, 100, 40], [1000, 100, 100]]);
  assert.ok(Math.abs(c.minWidth(5) - 40) < 1, "the pinch is 40 wide");
  const flat = GK.Corridor.make([[0, 100, 80], [1000, 100, 80]]);
  assert.equal(flat.minWidth(5), 80);
});

/* -------------------------------------------------------- Corridor.lint */

test("a good corridor lints clean", () => {
  assert.deepEqual(
    GK.Corridor.lint(CAVE, { bounds: [0, 225], margin: 3, minWidth: 60, maxWidth: 130, maxSlope: 0.2 }),
    []);
});

test("the corridor linter catches stations that do not advance", () => {
  const fails = GK.Corridor.lint([[0, 100, 80], [100, 100, 80], [100, 90, 80]]);
  assert.equal(fails.length, 1, "and bails out rather than sampling a broken list");
  assert.match(fails[0], /does not advance/);
});

test("the corridor linter catches a passage that leaves the stage", () => {
  const fails = GK.Corridor.lint([[0, 30, 100], [500, 30, 100]], { bounds: [0, 225], margin: 3 });
  assert.ok(fails.some((m) => /low wall leaves the stage/.test(m)), fails[0]);
});

test("the corridor linter catches a pinch and a climb the player cannot make", () => {
  const pinch = GK.Corridor.lint([[0, 112, 100], [500, 112, 20], [1000, 112, 100]], { minWidth: 60 });
  assert.ok(pinch.some((m) => /narrows to/.test(m)));
  const cliff = GK.Corridor.lint([[0, 40, 60], [100, 190, 60]], { maxSlope: 0.2 });
  assert.ok(cliff.some((m) => /climbs at/.test(m)), "a 150px rise over 100px is a wall");
});

/* ------------------------------------------------------------- plumbing */

test("both shapes accept object stations as well as tuples", () => {
  const a = GK.Route.make([[0, 0], [4, 0]]);
  const b = GK.Route.make([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  assert.equal(a.len, b.len);
  const c = GK.Corridor.make([[0, 10, 4], [8, 20, 6]]);
  const d = GK.Corridor.make([{ x: 0, c: 10, w: 4 }, { x: 8, c: 20, w: 6 }]);
  assert.deepEqual(c.sample(4), d.sample(4));
});

test("a one-point path is refused rather than silently producing NaN", () => {
  assert.throws(() => GK.Route.make([[0, 0]]), /at least two waypoints/);
  assert.throws(() => GK.Corridor.make([[0, 1, 2]]), /at least two stations/);
});
