// gamekit · gk-profiles.js — family profile roster with emoji avatars,
// optional 4-digit PINs (with admin override), type-the-name delete
// confirmation, and a leaderboard renderer.
//
// Extracted from WordVoyage js/main.js + Chicken Cross App (identical flows).
// The module injects its own modal markup (styled by gk-base.css), so games
// only provide a <div id="profile-list"> inside their profiles screen.
//
//   GK.Profiles.init({
//     storage:  GK.createStorage(...),
//     avatars:  ["🦊","🐼",...],
//     meta:     (profile, progress) => `⭐ ${progress.score}`, // card stats line
//     onEnter:  (profile) => { ... },       // called after selection/creation
//     adminPin: "7777",                     // parent override for any PIN
//     listEl:   "profile-list",
//     addLabel: "New Player",
//     maxNameLen: 14,
//   });
//
// Then call GK.Profiles.renderList() whenever the roster screen is shown.
window.GK = window.GK || {};

GK.Profiles = {
  cfg: null,
  current: null,   // the selected profile

  init(cfg) {
    this.cfg = Object.assign({ adminPin: "7777", listEl: "profile-list", addLabel: "New Player", maxNameLen: 14 }, cfg);
    this._injectModals();
  },

  esc(s) { return GK.util.esc(s); },
  el(id) { return document.getElementById(id); },

  /* -------------------------------------------------- roster rendering */
  renderList() {
    const { storage, meta } = this.cfg;
    const wrap = this.el(this.cfg.listEl);
    wrap.innerHTML = "";
    for (const p of storage.getProfiles()) {
      const prog = storage.getProgress(p.id);
      const d = document.createElement("div");
      d.className = "profile-card";
      d.setAttribute("role", "button");
      d.innerHTML = `<span class="avatar">${p.avatar}</span>
        <span class="pname">${this.esc(p.name)}</span>
        <span class="pmeta">${meta(p, prog)}</span>
        <span class="row-btns">
          <button class="ppin" title="${p.pin ? "PIN protected" : "Set a PIN"}">${p.pin ? "🔒" : "🔓"}</button>
          <button class="pdelete" title="Delete profile">🗑️</button>
        </span>`;
      d.onclick = () => this.select(p);
      d.querySelector(".pdelete").onclick = (e) => this.askDelete(p, e);
      d.querySelector(".ppin").onclick = (e) => this.managePin(p, e);
      wrap.appendChild(d);
    }
    const add = document.createElement("div");
    add.className = "profile-card add";
    add.setAttribute("role", "button");
    add.innerHTML = `<span class="avatar">➕</span><span class="pname">${this.esc(this.cfg.addLabel)}</span>`;
    add.onclick = () => this.showNew();
    wrap.appendChild(add);
  },

  // The profile last played on THIS device (storage settings), or null if it
  // no longer exists. Splash screens use it for a one-tap "Continue as X".
  lastProfile() {
    const id = this.cfg.storage.getSettings().lastProfile;
    return (id && this.cfg.storage.getProfiles().find(p => p.id === id)) || null;
  },

  select(p) {
    GK.Sfx.click();
    if (p.pin) {
      this.openPin({
        title: `${p.avatar} ${this.esc(p.name)} is locked`, sub: "Enter the 4-digit PIN",
        mode: "verify", profile: p, onSuccess: () => this._enter(p),
      });
    } else this._enter(p);
  },

  _enter(p) {
    this.current = p;
    const s = this.cfg.storage.getSettings();
    s.lastProfile = p.id;
    this.cfg.storage.saveSettings(s);
    this.cfg.onEnter(p);
  },

  /* -------------------------------------------------- create profile */
  showNew() {
    GK.Sfx.click();
    const grid = this.el("gk-avatar-grid");
    grid.innerHTML = "";
    this.cfg.avatars.forEach((a, i) => {
      const b = document.createElement("button");
      b.className = "avatar-choice" + (i === 0 ? " selected" : "");
      b.textContent = a;
      b.onclick = () => {
        grid.querySelectorAll(".selected").forEach(n => n.classList.remove("selected"));
        b.classList.add("selected");
        GK.Sfx.click();
      };
      grid.appendChild(b);
    });
    this.el("gk-new-name").value = "";
    this.el("gk-new-pin").value = "";
    GK.UI.openModal("gk-new-profile-modal");
    this.el("gk-new-name").focus();
  },

  create() {
    const name = this.el("gk-new-name").value.trim();
    if (!name) { this.el("gk-new-name").focus(); return; }
    const pin = this.el("gk-new-pin").value.trim();
    if (pin && !/^\d{4}$/.test(pin)) { this.el("gk-new-pin").focus(); return; }
    const avatar = document.querySelector("#gk-avatar-grid .selected")?.textContent || this.cfg.avatars[0];
    const p = this.cfg.storage.addProfile(name.slice(0, this.cfg.maxNameLen), avatar, pin || null);
    GK.UI.closeModal("gk-new-profile-modal");
    GK.Sfx.win();
    this._enter(p);
  },

  /* -------------------------------------------------- delete profile */
  askDelete(p, ev) {
    ev.stopPropagation();
    GK.Sfx.click();
    const go = () => {
      this._del = p;
      this.el("gk-del-title").textContent = `Delete ${p.avatar} ${p.name}?`;
      this.el("gk-del-name").textContent = p.name;
      this.el("gk-del-confirm").value = "";
      this.el("gk-btn-delete-confirm").disabled = true;
      GK.UI.openModal("gk-delete-modal");
      this.el("gk-del-confirm").focus();
    };
    if (p.pin) this.openPin({ title: `${this.esc(p.name)} is PIN protected`, sub: "Enter PIN to delete", mode: "verify", profile: p, onSuccess: go });
    else go();
  },

  _updateDeleteButton() {
    const typed = this.el("gk-del-confirm").value.trim().toLowerCase();
    this.el("gk-btn-delete-confirm").disabled = typed !== (this._del?.name || "").toLowerCase();
  },

  confirmDelete() {
    const p = this._del;
    if (!p) return;
    if (this.el("gk-del-confirm").value.trim().toLowerCase() !== p.name.toLowerCase()) return;
    this.cfg.storage.deleteProfile(p.id);
    if (this.current?.id === p.id) this.current = null;
    this._del = null;
    GK.UI.closeModal("gk-delete-modal");
    GK.Sfx.lose();
    this.renderList();
  },

  /* -------------------------------------------------- PIN keypad */
  openPin(ctx) {
    this._pin = { digits: "", ...ctx };
    this.el("gk-pin-title").innerHTML = ctx.title;
    this.el("gk-pin-sub").textContent = ctx.sub || "";
    this.el("gk-btn-pin-remove").style.display = ctx.allowRemove ? "" : "none";
    const pad = this.el("gk-pin-pad");
    if (!pad.dataset.built) {
      pad.dataset.built = "1";
      for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]) {
        const b = document.createElement("button");
        b.className = "pin-key" + (k === "" ? " blank" : "");
        b.textContent = k;
        if (k !== "") b.onclick = () => this._pinKey(k);
        pad.appendChild(b);
      }
    }
    this._renderPinDots();
    GK.UI.openModal("gk-pin-modal");
  },

  closePin() {
    this._pin = null;
    GK.UI.closeModal("gk-pin-modal");
  },

  _renderPinDots() {
    const n = this._pin ? this._pin.digits.length : 0;
    [...this.el("gk-pin-dots").children].forEach((d, i) => d.classList.toggle("on", i < n));
  },

  _pinKey(k) {
    if (!this._pin) return;
    GK.Sfx.click();
    if (k === "⌫") this._pin.digits = this._pin.digits.slice(0, -1);
    else if (this._pin.digits.length < 4) this._pin.digits += k;
    this._renderPinDots();
    if (this._pin.digits.length === 4) setTimeout(() => this._pinComplete(), 120);
  },

  _pinComplete() {
    if (!this._pin) return;
    const { digits, mode, profile, onSuccess } = this._pin;
    if (mode === "verify") {
      if (digits === profile.pin || digits === this.cfg.adminPin) {
        GK.Sfx.win();
        this.closePin();
        onSuccess();
      } else {
        GK.Sfx.wrong();
        const dots = this.el("gk-pin-dots");
        dots.classList.add("shake");
        setTimeout(() => {
          dots.classList.remove("shake");
          if (this._pin) { this._pin.digits = ""; this._renderPinDots(); }
        }, 450);
      }
    } else { // set
      profile.pin = digits;
      this.cfg.storage.updateProfile(profile);
      GK.Sfx.win();
      this.closePin();
      this.renderList();
    }
  },

  managePin(p, ev) {
    ev.stopPropagation();
    GK.Sfx.click();
    const openSet = () => this.openPin({
      title: `${p.pin ? "New" : "Set a"} PIN for ${p.avatar} ${this.esc(p.name)}`,
      sub: "Tap 4 digits — don't forget them!",
      mode: "set", profile: p, allowRemove: !!p.pin,
    });
    if (p.pin) this.openPin({ title: `Change ${this.esc(p.name)}'s PIN`, sub: "Enter the current PIN first", mode: "verify", profile: p, onSuccess: openSet });
    else openSet();
  },

  removePin() {
    if (!this._pin?.profile) return;
    const p = this._pin.profile;
    p.pin = null;
    this.cfg.storage.updateProfile(p);
    GK.Sfx.click();
    this.closePin();
    this.renderList();
  },

  /* -------------------------------------------------- leaderboard */
  // rows: storage.profilesWithProgress(); cols(row) returns the stat cells html.
  renderLeaderboard(elId, { cols, sort, meId, empty = "No players yet!" }) {
    const wrap = this.el(elId);
    wrap.innerHTML = "";
    const rows = this.cfg.storage.profilesWithProgress().sort(sort);
    const medals = ["🥇", "🥈", "🥉"];
    rows.forEach((r, i) => {
      const d = document.createElement("div");
      d.className = "lb-row" + (meId && r.id === meId ? " me" : "");
      d.innerHTML = `<span class="lb-rank">${medals[i] || (i + 1)}</span>
        <span class="lb-avatar">${r.avatar}</span>
        <span class="lb-name">${this.esc(r.name)}</span>${cols(r)}`;
      wrap.appendChild(d);
    });
    if (!rows.length) wrap.innerHTML = `<div class="lb-empty">${empty}</div>`;
  },

  /* -------------------------------------------------- injected markup */
  _injectModals() {
    GK.UI.inject(`
<div class="modal" id="gk-new-profile-modal">
  <div class="sheet">
    <h2>New Player</h2>
    <input id="gk-new-name" maxlength="${this.cfg.maxNameLen}" placeholder="Name" autocomplete="off"
           onkeydown="if(event.key==='Enter')GK.Profiles.create()" />
    <div class="avatar-grid" id="gk-avatar-grid"></div>
    <input id="gk-new-pin" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="PIN (optional, 4 digits)" autocomplete="off"
           oninput="this.value=this.value.replace(/\\D/g,'')"
           onkeydown="if(event.key==='Enter')GK.Profiles.create()" />
    <div class="row-btns2">
      <button class="btn grey" onclick="GK.UI.closeModal('gk-new-profile-modal')">Cancel</button>
      <button class="btn green" onclick="GK.Profiles.create()">Create</button>
    </div>
  </div>
</div>
<div class="modal" id="gk-delete-modal">
  <div class="sheet">
    <h2 id="gk-del-title">Delete?</h2>
    <p>This removes the profile and all its progress on every device. Type <b id="gk-del-name"></b> to confirm.</p>
    <input id="gk-del-confirm" placeholder="Type name" autocomplete="off"
           oninput="GK.Profiles._updateDeleteButton()"
           onkeydown="if(event.key==='Enter')GK.Profiles.confirmDelete()" />
    <div class="row-btns2">
      <button class="btn grey" onclick="GK.UI.closeModal('gk-delete-modal')">Cancel</button>
      <button class="btn danger" id="gk-btn-delete-confirm" onclick="GK.Profiles.confirmDelete()">Delete</button>
    </div>
  </div>
</div>
<div class="modal" id="gk-pin-modal">
  <div class="sheet">
    <h2 id="gk-pin-title"></h2>
    <p id="gk-pin-sub"></p>
    <div class="pin-dots" id="gk-pin-dots"><span></span><span></span><span></span><span></span></div>
    <div class="pin-pad" id="gk-pin-pad"></div>
    <div class="row-btns2">
      <button class="btn grey" onclick="GK.Profiles.closePin()">Cancel</button>
      <button class="btn danger" id="gk-btn-pin-remove" onclick="GK.Profiles.removePin()">Remove PIN</button>
    </div>
  </div>
</div>`);
  },
};
