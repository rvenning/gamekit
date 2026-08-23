"use strict";
// Tests for the two halves of "why is this menu silent?".
//
//   gk-audio    — a browser blocks an AudioContext outside a user gesture, so
//                 every GK.Sfx call no-ops until one arrives. The kit wakes
//                 itself on the first gesture, in the CAPTURE phase, so the
//                 very click that opened the screen is already audible.
//   gk-ui       — bindMenuClicks gives a button its click only if the button's
//                 own handler stayed silent, so nothing ever doubles up.
//
//   cd gamekit && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../tools/test-harness.js");

const GK_DIR = path.join(__dirname, "..", "gk");

/* ------------------------------------------------------------------ fake DOM */
// Just enough of one to dispatch a click the way a browser does: document
// capture listeners, then the element's own handler, then document bubble
// listeners. That ordering IS the feature under test.

function makeEl({ tag = "button", id = "", role = "", disabled = false, parent = null } = {}) {
  const el = {
    tag, id, role, disabled, parent, onclick: null,
    matches(sel) {
      return sel.split(",").map(s => s.trim()).filter(Boolean).some(s =>
        s.startsWith("#") ? this.id === s.slice(1)
          : s === "[role=button]" ? this.role === "button"
          : this.tag === s);
    },
    closest(sel) {
      for (let n = this; n; n = n.parent) if (n.matches(sel)) return n;
      return null;
    },
  };
  return el;
}

function makeDocument() {
  const listeners = { capture: {}, bubble: {} };
  return {
    listeners,
    addEventListener(type, fn, opts) {
      // The DOM takes capture as either a bare boolean or { capture: true },
      // and the kit uses both spellings.
      const phase = opts === true || (opts && opts.capture) ? "capture" : "bubble";
      (listeners[phase][type] = listeners[phase][type] || []).push(fn);
    },
    removeEventListener() {},
    visibilityState: "visible",
    fire(type, ev = {}) {
      for (const p of ["capture", "bubble"]) (listeners[p][type] || []).forEach(f => f(ev));
    },
    // A click walks the tree: document capture -> the button -> document bubble.
    click(el) {
      const ev = { target: el };
      (listeners.capture.click || []).forEach(f => f(ev));
      if (el && el.onclick) el.onclick(ev);
      (listeners.bubble.click || []).forEach(f => f(ev));
    },
  };
}

// A stand-in AudioContext that records what the kit asked of it.
function makeAudioContext() {
  const log = { made: 0, resumed: 0 };
  const node = { connect: (n) => n, start() {}, stop() {} };
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  class AC {
    constructor() { log.made++; this.state = AC.startState; this.currentTime = 0; this.sampleRate = 48000; this.destination = node; }
    resume() { log.resumed++; this.state = "running"; }
    createOscillator() { return { ...node, type: "sine", frequency: param }; }
    createGain() { return { ...node, gain: param }; }
    createBuffer(ch, n) { return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { ...node, buffer: null }; }
  }
  AC.startState = "running";
  return { AC, log };
}

function load({ startState = "running" } = {}) {
  const document = makeDocument();
  const { AC, log } = makeAudioContext();
  AC.startState = startState;
  const sandbox = loadScripts({
    baseDir: GK_DIR,
    files: ["gk-audio.js", "gk-ui.js"],
    browser: true,
    globals: { document, AudioContext: AC },
  });
  return { GK: sandbox.GK, document, log };
}

/* ------------------------------------------------------------- waking up */

test("no sound until a gesture arrives, then the gesture itself is audible", () => {
  const { GK, document, log } = load();

  // Before any gesture there is no context, and every call is a silent no-op —
  // this is exactly the state a splash screen used to sit in.
  assert.equal(GK.Sfx.ctx, null);
  GK.Sfx.click();
  assert.equal(GK.Sfx.plays, 0);

  document.fire("pointerdown");
  assert.equal(log.made, 1);
  GK.Sfx.click();
  assert.equal(GK.Sfx.plays, 1);
});

test("the wake listener is on capture, so it beats the button's own handler", () => {
  const { document } = load();
  assert.ok((document.listeners.capture.pointerdown || []).length, "pointerdown wakes on capture");
  assert.ok((document.listeners.capture.keydown || []).length, "keyboard counts as a gesture too");
  assert.equal((document.listeners.bubble.pointerdown || []).length, 0);
});

test("a suspended context is resumed on every later gesture, not just the first", () => {
  // iOS suspends the context whenever the app is backgrounded, so a phone that
  // has been in a pocket mid-game must come back with sound.
  const { GK, document, log } = load({ startState: "suspended" });
  document.fire("pointerdown");
  assert.equal(log.made, 1);
  assert.equal(log.resumed, 1);

  GK.Sfx.ctx.state = "suspended";
  document.fire("pointerdown");
  assert.equal(log.made, 1, "the same context is reused");
  assert.equal(log.resumed, 2);
});

test("muted stays muted", () => {
  const { GK, document } = load();
  document.fire("pointerdown");
  GK.Sfx.enabled = false;
  GK.Sfx.click();
  GK.Sfx.noise({ dur: 0.1 });
  assert.equal(GK.Sfx.plays, 0);
});

/* -------------------------------------------------------- bindMenuClicks */

function menu() {
  const kit = load();
  kit.document.fire("pointerdown");          // wake the context
  kit.GK.UI.bindMenuClicks();
  kit.GK.Sfx.plays = 0;
  return kit;
}

test("a menu button with a silent handler still clicks", () => {
  const { GK, document } = menu();
  const btn = makeEl({ id: "btn-play" });
  document.click(btn);
  assert.equal(GK.Sfx.plays, 1);
});

test("a button that makes its own sound is left alone", () => {
  const { GK, document } = menu();
  const btn = makeEl({ id: "btn-buy" });
  btn.onclick = () => GK.Sfx.coin();       // coin is two notes
  document.click(btn);
  assert.equal(GK.Sfx.plays, 2, "the coin, and no click stapled on top");
});

test("gameplay, disabled buttons and bare backgrounds stay quiet", () => {
  const { GK, document } = menu();
  const screen = makeEl({ tag: "div", id: "screen-game" });

  document.click(makeEl({ id: "btn-fire", parent: screen }));
  assert.equal(GK.Sfx.plays, 0, "the game speaks for itself");

  document.click(makeEl({ id: "btn-locked", disabled: true }));
  assert.equal(GK.Sfx.plays, 0, "a locked level card is not a button press");

  document.click(makeEl({ tag: "div", id: "wallpaper" }));
  assert.equal(GK.Sfx.plays, 0, "tapping the background is not a button press");
});

test("a div carrying role=button counts — profile cards are divs", () => {
  const { GK, document } = menu();
  document.click(makeEl({ tag: "div", role: "button", id: "profile-card" }));
  assert.equal(GK.Sfx.plays, 1);
});

test("quiet can be opened up for a game whose #screen-game is really a menu", () => {
  const kit = load();
  kit.document.fire("pointerdown");
  kit.GK.UI.bindMenuClicks({ quiet: "" });
  kit.GK.Sfx.plays = 0;
  const screen = makeEl({ tag: "div", id: "screen-game" });
  kit.document.click(makeEl({ id: "btn-deal", parent: screen }));
  assert.equal(kit.GK.Sfx.plays, 1);
});

test("binding twice does not double every click", () => {
  const { GK, document } = menu();
  GK.UI.bindMenuClicks();
  document.click(makeEl({ id: "btn-play" }));
  assert.equal(GK.Sfx.plays, 1);
});
