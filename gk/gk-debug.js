// gamekit · gk-debug.js — developer tools behind ?debug=1.
//
// Off unless the page URL carries ?debug=1, so a normal player never sees or
// runs any of this. Games register their own controls; the kit supplies the
// panel, the FPS readout, and one safety rule.
//
//   GK.Debug.init({ storage: Storage });
//   GK.Debug.toggle("hitboxes", "hitboxes");
//   GK.Debug.action("win level", () => Game.win());
//   GK.Debug.jump("level", LEVELS.length, (n) => App.startLevel(n - 1));
//   // in the game loop:   GK.Debug.frame(dt);
//   // in the renderer:    if (GK.Debug.flag("hitboxes")) drawBoxes();
//
// SAFETY: while debug is on, progress writes are suppressed. Level-jumping or
// flying through hazards on a real profile would otherwise persist — and
// because family sync merges progress by MAX, an inflated score is permanent
// on every device. Debug is an inspection mode: look at anything, change
// nothing. The panel says "saves off" so it can't be mistaken.
//
// Every method is a no-op when debug is off, so games call them unconditionally
// and `flag()` simply returns false.
window.GK = window.GK || {};

GK.Debug = {
  on: (() => {
    try { return new URLSearchParams(location.search).get("debug") === "1"; }
    catch { return false; }
  })(),

  flags: {},
  fps: 0,
  _frames: 0, _elapsed: 0, _panel: null, _rows: null,

  // `storage` is the object from GK.createStorage; passing it enables the
  // saves-off rule. Safe to call more than once.
  init({ storage = null, title = "DEBUG" } = {}) {
    if (!this.on || this._panel) return this;
    this._injectStyle();

    const panel = document.createElement("div");
    panel.className = "gk-debug";
    panel.innerHTML =
      `<div class="gk-debug-head"><b>${title}</b><span class="gk-debug-fps">– fps</span>` +
      `<button class="gk-debug-min" title="collapse">–</button></div>` +
      `<div class="gk-debug-rows"></div>` +
      `<div class="gk-debug-note"></div>`;
    document.body.appendChild(panel);
    this._panel = panel;
    this._rows = panel.querySelector(".gk-debug-rows");

    panel.querySelector(".gk-debug-min").onclick = () => panel.classList.toggle("mini");

    if (storage && typeof storage.saveProgress === "function") {
      storage.saveProgress = () => {};          // inspection mode
      panel.querySelector(".gk-debug-note").textContent = "saves off — progress is not written";
    } else {
      panel.querySelector(".gk-debug-note").textContent = "no storage passed — saves NOT suppressed";
    }
    return this;
  },

  // A sticky on/off control. Read it back with flag(key).
  toggle(key, label, initial = false) {
    if (!this.on) return this;
    this.flags[key] = initial;
    const b = document.createElement("button");
    b.textContent = label || key;
    b.className = "gk-debug-btn" + (initial ? " on" : "");
    b.onclick = () => {
      this.flags[key] = !this.flags[key];
      b.classList.toggle("on", this.flags[key]);
    };
    this._row().appendChild(b);
    return this;
  },

  // A fire-once button.
  action(label, fn) {
    if (!this.on) return this;
    const b = document.createElement("button");
    b.textContent = label;
    b.className = "gk-debug-btn";
    b.onclick = () => { try { fn(); } catch (e) { console.warn("debug action failed:", e); } };
    this._row().appendChild(b);
    return this;
  },

  // A number box + Go, for jumping to a level. `fn` receives a 1-based number.
  jump(label, max, fn) {
    if (!this.on) return this;
    const wrap = document.createElement("span");
    wrap.className = "gk-debug-jump";
    const input = document.createElement("input");
    input.type = "number"; input.min = 1; input.max = max; input.placeholder = label;
    const go = document.createElement("button");
    go.textContent = "go"; go.className = "gk-debug-btn";
    const fire = () => {
      const n = parseInt(input.value, 10);
      if (!(n >= 1 && n <= max)) return GK.Debug.note(`${label} must be 1–${max}`);
      try { fn(n); } catch (e) { console.warn("debug jump failed:", e); }
    };
    go.onclick = fire;
    input.onkeydown = (e) => { if (e.key === "Enter") fire(); };
    wrap.append(input, go);
    this._row().appendChild(wrap);
    return this;
  },

  flag(key) { return this.on ? !!this.flags[key] : false; },

  // Transient message under the controls.
  note(text) {
    if (!this.on || !this._panel) return this;
    const el = this._panel.querySelector(".gk-debug-note");
    el.textContent = text;
    clearTimeout(this._noteTimer);
    this._noteTimer = setTimeout(() => { el.textContent = "saves off — progress is not written"; }, 2500);
    return this;
  },

  // Call once per frame with the real delta (seconds) to drive the readout.
  frame(dt) {
    if (!this.on) return;
    this._frames++; this._elapsed += dt;
    if (this._elapsed >= 0.5) {
      this.fps = Math.round(this._frames / this._elapsed);
      this._frames = 0; this._elapsed = 0;
      if (this._panel) this._panel.querySelector(".gk-debug-fps").textContent = this.fps + " fps";
    }
  },

  // Rows hold 3 controls each, so the panel stays narrow.
  _row() {
    let row = this._rows.lastElementChild;
    if (!row || row.childElementCount >= 3) {
      row = document.createElement("div");
      row.className = "gk-debug-row";
      this._rows.appendChild(row);
    }
    return row;
  },

  _injectStyle() {
    if (document.getElementById("gk-debug-style")) return;
    const s = document.createElement("style");
    s.id = "gk-debug-style";
    s.textContent = `
.gk-debug { position:fixed; left:8px; bottom:8px; z-index:9999; width:230px;
  background:rgba(15,18,24,0.9); color:#e6edf3; border:1px solid #39414d;
  border-radius:10px; padding:6px 8px; font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;
  box-shadow:0 6px 20px rgba(0,0,0,0.4); }
.gk-debug-head { display:flex; align-items:center; gap:6px; }
.gk-debug-head b { letter-spacing:0.08em; color:#ffd93b; }
.gk-debug-fps { margin-left:auto; opacity:0.75; }
.gk-debug-min { background:none; border:none; color:#e6edf3; cursor:pointer;
  font:inherit; padding:0 4px; }
.gk-debug.mini .gk-debug-rows, .gk-debug.mini .gk-debug-note { display:none; }
.gk-debug-row { display:flex; flex-wrap:wrap; gap:4px; margin-top:5px; }
.gk-debug-btn { background:#252c36; color:#e6edf3; border:1px solid #39414d;
  border-radius:6px; padding:3px 7px; font:inherit; cursor:pointer; }
.gk-debug-btn:hover { background:#2f3742; }
.gk-debug-btn.on { background:#2e7d4f; border-color:#3fa06a; color:#fff; }
.gk-debug-jump { display:flex; gap:3px; }
.gk-debug-jump input { width:52px; background:#252c36; color:#e6edf3;
  border:1px solid #39414d; border-radius:6px; padding:3px 5px; font:inherit; }
.gk-debug-note { margin-top:6px; opacity:0.65; font-size:11px; }`;
    document.head.appendChild(s);
  },
};
