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

  // Inject a chunk of HTML (modal boilerplate etc.) at the end of <body>.
  inject(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    while (div.firstChild) document.body.appendChild(div.firstChild);
  },
};
