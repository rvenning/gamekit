"use strict";
// Behaviour tests for gk-fx.js — the shared juice layer. Nothing here can
// corrupt a save, so these cover the things that would quietly ruin the feel
// of every game at once: particles that never die (a leak that degrades the
// frame rate the longer you play), shake that never settles, slow-motion that
// slows its own recovery and so never ends, and the per-game tuning that lets
// Deep Jungle and Brick Breaker keep their own look off one module.
//
//   cd gamekit && node --test
//
// gk-fx.js is a browser script hanging off a `window.GK` global, so it runs in
// a vm sandbox. Rendering is checked against a recording fake 2D context.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const GK_DIR = path.join(__dirname, "..", "gk");

// Fresh sandbox per call so tests never share Fx state or config.
function loadFx() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ["gk-util.js", "gk-fx.js"]) {
    vm.runInContext(fs.readFileSync(path.join(GK_DIR, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox.GK;
}

// Records the calls a render pass makes, so we can assert on shape choice
// without a canvas.
function makeCtx() {
  const calls = [];
  // Alpha is recorded at draw time: render() resets globalAlpha to 1 when it
  // finishes, so reading it afterwards would tell us nothing.
  const ctx = {
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 0, font: "",
    textAlign: "", textBaseline: "",
    fillRect: (...a) => calls.push(["fillRect", ctx.globalAlpha, ...a]),
    arc: (...a) => calls.push(["arc", ctx.globalAlpha, ...a]),
    fillText: (...a) => calls.push(["fillText", ctx.globalAlpha, ...a]),
    beginPath() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    save() {}, restore() {}, translate() {}, rotate() {},
  };
  ctx.calls = calls;
  return ctx;
}

// Run `secs` of frames at 60fps.
function run(Fx, secs) { for (let i = 0; i < Math.round(secs * 60); i++) Fx.update(1 / 60); }

test("particles expire rather than accumulating", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.burst(0, 0, "#fff", 20, 160, 0.5, 3);
  assert.equal(Fx.parts.length, 20);
  run(Fx, 1.0);                       // longest possible life is 0.5 * 1.0
  assert.equal(Fx.parts.length, 0, "every particle should have died");
});

test("the pool is capped, dropping oldest first", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.configure({ poolCap: 50 });
  for (let i = 0; i < 20; i++) Fx.burst(0, 0, "#fff", 12);
  assert.equal(Fx.parts.length, 50, "pool must not grow without bound");
});

test("shake decays to a standstill and saturates on pile-up", () => {
  const { Fx } = loadFx();
  Fx.reset();
  for (let i = 0; i < 50; i++) Fx.addShake(5);
  assert.equal(Fx.shake, Fx.cfg.shakeMax, "shake should clamp, not blind the player");
  run(Fx, 2);
  assert.equal(Fx.shake, 0, "shake should settle back to zero");
});

test("flash fades out", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.addFlash(1, "#ff0");
  assert.equal(Fx.flashColor, "#ff0");
  run(Fx, 1);
  assert.equal(Fx.flash, 0);
});

test("slow-motion ends — it must not slow its own recovery", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.slowMo(0.25, 0.5);
  assert.equal(Fx.timeScale, 0.25);
  run(Fx, 0.6);
  assert.equal(Fx.timeScale, 1, "timeScale should have returned to normal");
});

test("slow-motion slows particles but not floating text", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.text(0, 0, "+100", { life: 1 });
  Fx.parts.push({ x: 0, y: 0, vx: 100, vy: 0, life: 10, t: 0, color: "#fff", size: 2, grav: 0 });
  Fx.slowMo(0.5, 10);
  run(Fx, 1);
  assert.ok(Math.abs(Fx.parts[0].x - 50) < 1e-6, "particle should travel at half speed");
  assert.equal(Fx.texts.length, 0, "text runs on real time and should have expired");
});

test("confetti tumbles and is culled below the canvas", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.confetti(300, 200, ["#f00", "#0f0"], 30);
  assert.equal(Fx.parts.length, 30);
  assert.ok(Fx.parts.every(p => p.shape === "rect"), "confetti should be rectangles");
  const a0 = Fx.parts[0].a;
  Fx.update(1 / 60);
  assert.notEqual(Fx.parts[0].a, a0, "confetti should spin");
  run(Fx, 3);
  assert.equal(Fx.parts.length, 0, "confetti should be culled past the bottom edge");
});

test("confetti holds its colour and only fades as it runs out", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.confetti(300, 5000, ["#f00"], 1);   // tall canvas so it isn't culled
  const p = Fx.parts[0];
  p.life = 2; p.t = 0;
  const alphaAt = (t) => { p.t = t; const c = makeCtx(); Fx.render(c); return c.calls[0][1]; };
  // a linear fade would already be at 0.75 here; late fade should still be solid
  assert.equal(alphaAt(0.5), 1, "confetti should stay solid while it has time left");
  assert.ok(Math.abs(alphaAt(1.5) - 0.5) < 1e-9, "and fade over its final second");
});

test("per-game tuning changes gravity, shape and burst defaults", () => {
  const bb = loadFx().Fx;                       // Brick Breaker defaults
  bb.reset();
  bb.burst(0, 0, "#fff", 1);
  assert.equal(bb.parts[0].grav, 260);

  const dj = loadFx().Fx;                       // Deep Jungle's own feel
  dj.reset();
  dj.configure({ grav: 300, poolCap: 700, shape: "square", burstSpeed: 130, burstSize: 2.4 });
  dj.burst(0, 0, "#fff", 1);
  assert.equal(dj.parts[0].grav, 300, "Deep Jungle keeps its heavier gravity");

  // ...and the two instances are independent, so one game can't retune another.
  assert.equal(bb.cfg.grav, 260);
  assert.equal(bb.cfg.shape, "circle");
});

test("shape config picks square vs circle at render time", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.parts.push({ x: 5, y: 5, vx: 0, vy: 0, life: 1, t: 0, color: "#fff", size: 4, grav: 0 });
  const circle = makeCtx();
  Fx.render(circle);
  assert.ok(circle.calls.some(c => c[0] === "arc"), "default shape should draw a circle");

  Fx.configure({ shape: "square" });
  const square = makeCtx();
  Fx.render(square);
  assert.ok(square.calls.some(c => c[0] === "fillRect"), "square config should draw a rect");
  assert.ok(!square.calls.some(c => c[0] === "arc"));
});

test("reset clears everything, including slow-motion", () => {
  const { Fx } = loadFx();
  Fx.burst(0, 0, "#fff", 10);
  Fx.text(0, 0, "x");
  Fx.lightning(0, 0, 10, 10);
  Fx.addShake(5); Fx.addFlash(1); Fx.slowMo(0.2, 5);
  Fx.reset();
  assert.deepEqual(
    { parts: Fx.parts.length, texts: Fx.texts.length, bolts: Fx.bolts.length,
      shake: Fx.shake, flash: Fx.flash, timeScale: Fx.timeScale },
    { parts: 0, texts: 0, bolts: 0, shake: 0, flash: 0, timeScale: 1 });
});

test("tween runs to its exact end value and then stops", () => {
  const { Tween } = loadFx();
  Tween.clear();
  const obj = { x: 0, y: 10 };
  Tween.to(obj, { x: 100, y: 0 }, 0.5);
  // 30 frames of 1/60 sum to just under 0.5 in floating point, so a tween can
  // finish one frame late. What matters is that it lands exactly on the target
  // and is then dropped -- not the precise frame it happens on.
  for (let i = 0; i < 31; i++) Tween.update(1 / 60);
  assert.equal(obj.x, 100, "must land exactly on the target, not near it");
  assert.equal(obj.y, 0);
  assert.equal(Tween.list.length, 0, "finished tweens should be dropped");
});

test("lightning bolts expire", () => {
  const { Fx } = loadFx();
  Fx.reset();
  Fx.lightning(0, 0, 50, 50);
  assert.equal(Fx.bolts.length, 1);
  assert.ok(Fx.bolts[0].pts.length >= 3, "a bolt should be a jagged polyline");
  run(Fx, 0.5);
  assert.equal(Fx.bolts.length, 0);
});
