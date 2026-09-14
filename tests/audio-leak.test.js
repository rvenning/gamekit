"use strict";
// GK.Sfx against a fake Web Audio context that counts connected nodes. Guards
// the iPad crackle: nodes that are never disconnected pile up in WebKit's render
// graph until the audio thread underruns.
//
//   cd gamekit && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../tools/test-harness.js");

const GK_DIR = path.join(__dirname, "..", "gk");

function fakeAudio() {
  const state = { live: 0, sources: [], now: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class Node {
    constructor() { this.connected = false; this.gain = param(); this.frequency = param(); this.onended = null; this.startAt = -1; this.stopAt = Infinity; }
    connect(next) { if (!this.connected) state.live++; this.connected = true; return next; }
    disconnect() { if (this.connected) state.live--; this.connected = false; }
    start(t) { this.startAt = t; state.sources.push(this); }
    stop(t) { this.stopAt = t; }
  }
  class Ctx {
    constructor() { this.state = "running"; this.sampleRate = 8000; this.destination = {}; }
    get currentTime() { return state.now; }
    createOscillator() { return new Node(); }
    createGain() { return new Node(); }
    createBufferSource() { return new Node(); }
    createBuffer(_c, n) { return { getChannelData: () => new Float32Array(n) }; }
    resume() {}
  }
  const advance = (s) => {
    state.now += s;
    for (const src of state.sources) if (src.onended && src.stopAt <= state.now) { const fn = src.onended; src.onended = null; fn(); }
  };
  return { state, Ctx, advance };
}

function loadSfx() {
  const audio = fakeAudio();
  const Sfx = loadScripts({
    baseDir: GK_DIR, files: ["gk-audio.js"], browser: true,
    globals: { AudioContext: audio.Ctx, document: { addEventListener() {} } },
  }).GK.Sfx;
  Sfx.ctx = new audio.Ctx();
  return { Sfx, audio };
}

test("every note and noise burst releases its nodes once it has finished", () => {
  const { Sfx, audio } = loadSfx();
  for (let level = 0; level < 50; level++) {
    Sfx.click(); Sfx.coin(); Sfx.win(); Sfx.lose(); Sfx.wrong();
    Sfx.noise({ dur: 0.3 });
    audio.advance(5);
  }
  assert.equal(audio.state.live, 0);
  assert.equal(Sfx.voices, 0);
});

test("noise bursts end on their own (a buffer source with no stop never fires onended)", () => {
  const { Sfx, audio } = loadSfx();
  Sfx.noise({ dur: 0.2 });
  audio.advance(1);
  assert.equal(audio.state.live, 0);
});

test("a late scheduler cannot start a note in the past", () => {
  const { Sfx, audio } = loadSfx();
  audio.state.now = 10;
  Sfx.tone({ freq: 440, when: -0.25 });
  assert.ok(audio.state.sources[0].startAt >= 10);
});

test("overlap is capped, and a dropped note still counts as played for bindMenuClicks", () => {
  const { Sfx } = loadSfx();
  for (let i = 0; i < 100; i++) Sfx.click();
  assert.equal(Sfx.voices, Sfx.MAX_VOICES);
  assert.equal(Sfx.plays, 100);
});
