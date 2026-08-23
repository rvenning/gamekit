// gamekit · gk-ui.js — screen navigation, modals, toast, sound toggle.
// Conventions (both games already follow them):
//   screens: <div class="screen" id="screen-NAME">, exactly one has .active
//   modals:  <div class="modal" id="X">, shown by adding .visible
//   toast:   <div class="toast" id="toast">
window.GK = window.GK || {};

GK.UI = {
  // Called after every showScreen with the new name — games hook this to
  // pause/resume engines (e.g. Game.active = name === "game").
  onScreenChange: null,

  el(id) { return document.getElementById(id); },

  showScreen(name) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    this.el("screen-" + name).classList.add("active");
    this.screen = name;
    if (this.onScreenChange) this.onScreenChange(name);
  },

  openModal(id) { this.el(id).classList.add("visible"); },
  closeModal(id) { this.el(id).classList.remove("visible"); },

  toast(msg) {
    const t = this.el("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
  },

  // Wires every .btn-sound button to toggle GK.Sfx and persist the setting.
  bindSoundToggle(storage) {
    const update = () => document.querySelectorAll(".btn-sound").forEach(b => b.textContent = GK.Sfx.enabled ? "🔊" : "🔇");
    document.querySelectorAll(".btn-sound").forEach(b => b.onclick = () => {
      GK.Sfx.enabled = !GK.Sfx.enabled;
      const s = storage.getSettings(); s.sound = GK.Sfx.enabled; storage.saveSettings(s);
      update(); GK.Sfx.click();
    });
    update();
  },

  // Gives every menu button a click, without hand-wiring dozens of handlers
  // and missing half of them. One listener at document level, in the BUBBLE
  // phase — after the button's own handler has run — clicks only if that handler
  // stayed silent, so a button with a sound of its own (a purchase, a star, a
  // page turn) keeps it and never doubles up. The capture pass records the
  // decision while the button is still in the DOM, because a handler that
  // re-renders the screen detaches it before the bubble pass sees it.
  //
  // quiet: a selector whose subtree stays untouched. Defaults to the gameplay
  // screen, where taps are moves and the game speaks for itself; pass "" for a
  // game whose #screen-game is really a menu (a scorer, a card dealer).
  bindMenuClicks({ selector = "button, [role=button]", quiet = "#screen-game" } = {}) {
    if (this._menuClicks) return;
    this._menuClicks = true;
    let armed = false, plays = 0;
    document.addEventListener("click", (e) => {
      const el = e.target.closest && e.target.closest(selector);
      armed = !!el && !el.disabled && !(quiet && el.closest(quiet));
      plays = GK.Sfx.plays;
    }, true);
    document.addEventListener("click", () => {
      if (armed && GK.Sfx.plays === plays) GK.Sfx.click();
      armed = false;
    });
  },

  // Inject a chunk of HTML (modal boilerplate etc.) at the end of <body>.
  inject(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    while (div.firstChild) document.body.appendChild(div.firstChild);
  },
};
