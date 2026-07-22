// gamekit · gk-storage.js — profiles + progress persistence with optional
// Firestore sync. Extracted from WordVoyage js/storage.js and Chicken Cross
// (the two implementations were ~95% identical; the differences are now the
// config object).
//
//   const Storage = GK.createStorage({
//     prefix: "cc",                    // localStorage keys: cc_settings, cc_profiles,
//                                      // cc_progress_<id>, cc_deleted
//     collection: "chickencross",      // Firestore collection (docs profile_<id>,
//                                      // progress_<id>, deleted_<id>)
//     firebaseConfig: {...} | null,    // null = localStorage only
//     blankProgress: () => ({ coins:0, levels:{}, updated:0 }),
//     mergeProgress: (a, b) => ({...}) // cross-device merge; must be commutative-ish:
//                                      // keep the best of both sides
//   });
//
// localStorage is the always-available source of truth; when Firebase is
// configured and reachable, profiles + progress are mirrored to Firestore so
// the family shares one roster and leaderboard across devices. Deletions
// write tombstone docs so a stale device can't resurrect a removed profile.
//
// Progress pushes are debounced (localStorage stays immediate): games save on
// every coin/word, which would otherwise mean one Firestore write per pickup
// mid-gameplay. Pending pushes flush after PUSH_DELAY, and immediately when
// the tab is hidden or closed.
window.GK = window.GK || {};

GK.createStorage = function (cfg) {
  const P = cfg.prefix + "_";
  const COL = cfg.collection;
  const PUSH_DELAY = 3000; // ms of quiet before pending progress hits Firestore

  return {
    fb: null,      // { db, doc, setDoc, ... } once Firestore is live
    online: false,
    uid: null,     // anonymous auth uid, once signed in
    authed: false,
    _pending: {},     // pid -> progress awaiting a debounced Firestore push
    _pushTimer: null,

    _get(k, f) { try { const v = JSON.parse(localStorage.getItem(P + k)); return v ?? f; } catch { return f; } },
    _set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch {} },
    _remove(k) { localStorage.removeItem(P + k); },

    /* ----- settings ----- */
    getSettings() { return this._get("settings", { sound: true, lastProfile: null }); },
    saveSettings(s) { this._set("settings", s); },

    /* ----- profiles ----- */
    getProfiles() { return this._get("profiles", []); },
    saveProfiles(p) { this._set("profiles", p); },

    addProfile(name, avatar, pin) {
      const ps = this.getProfiles();
      const p = { id: "p" + Date.now() + Math.floor(Math.random() * 1e4), name, avatar, pin: pin || null, created: Date.now(), updated: Date.now() };
      ps.push(p);
      this.saveProfiles(ps);
      this._pushProfile(p);
      return p;
    },

    updateProfile(p) {
      p.updated = Date.now();
      this.saveProfiles(this.getProfiles().map(x => x.id === p.id ? p : x));
      this._pushProfile(p);
    },

    // Deletes a profile everywhere. The tombstone doc stops other devices'
    // stale local copies from re-uploading it on their next sync.
    deleteProfile(id) {
      this.saveProfiles(this.getProfiles().filter(p => p.id !== id));
      this._remove("progress_" + id);
      delete this._pending[id]; // a queued push must not resurrect the doc
      this._set("deleted", [...new Set([...this._get("deleted", []), id])]);
      const s = this.getSettings();
      if (s.lastProfile === id) { s.lastProfile = null; this.saveSettings(s); }
      if (this.fb) {
        const { db, doc, setDoc, deleteDoc } = this.fb;
        deleteDoc(doc(db, COL, "profile_" + id)).catch(e => console.warn("delete profile failed", e));
        deleteDoc(doc(db, COL, "progress_" + id)).catch(e => console.warn("delete progress failed", e));
        setDoc(doc(db, COL, "deleted_" + id), { id, at: Date.now() }).catch(e => console.warn("tombstone failed", e));
      }
    },

    /* ----- progress ----- */
    getProgress(id) { return this._get("progress_" + id, cfg.blankProgress()); },

    saveProgress(id, prog) {
      prog.updated = Date.now();
      this._set("progress_" + id, prog);
      this._pushProgress(id, prog);
    },

    // Every profile with its progress attached — leaderboards start here.
    profilesWithProgress() {
      return this.getProfiles().map(p => ({ ...p, progress: this.getProgress(p.id) }));
    },

    /* ----- Firestore sync ----- */
    async initFirebase() {
      if (!cfg.firebaseConfig || !cfg.firebaseConfig.apiKey) return false;
      try {
        const appMod = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js");
        const fsMod = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");
        const authMod = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js");
        const app = appMod.initializeApp(cfg.firebaseConfig);
        await this.signInAnon(authMod, app);
        this.fb = { db: fsMod.getFirestore(app), ...fsMod };
        await this._syncDown();
        this.online = true;
        // Don't let a debounced push die with the tab: flush the moment the
        // page is hidden (locking, app-switching) or being unloaded.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") this.flushProgress();
        });
        window.addEventListener("pagehide", () => this.flushProgress());
        return true;
      } catch (e) {
        console.warn("Firebase unavailable, running on localStorage only:", e);
        this.fb = null;
        return false;
      }
    },

    // The Firebase config ships in every page load, so rules that allow
    // unauthenticated writes let anyone who views source wipe the family's
    // saves. The rules require request.auth != null; signing in anonymously
    // satisfies that without asking a five-year-old to log in anywhere. The
    // uid is per-device and per-browser, so it identifies nobody -- it is a
    // gate against drive-by scripts, not an account.
    //
    // Failure here is deliberately NOT fatal. If the Anonymous provider hasn't
    // been enabled in the console yet, carry on and let the rules decide:
    // throwing would take every game offline the moment this shipped, before
    // the console side was in place.
    async signInAnon(authMod, app) {
      try {
        const auth = authMod.getAuth(app);
        const cred = await authMod.signInAnonymously(auth);
        this.uid = (cred && cred.user && cred.user.uid) || (auth.currentUser && auth.currentUser.uid) || null;
        this.authed = !!this.uid;
      } catch (e) {
        this.uid = null;
        this.authed = false;
        console.warn("gamekit: anonymous auth unavailable, continuing unauthenticated:", (e && e.code) || e);
      }
      return this.authed;
    },

    async _syncDown() {
      const { db, doc, setDoc, deleteDoc, collection, getDocs } = this.fb;
      const snap = await getDocs(collection(db, COL));
      let remoteProfiles = [];
      const remoteProgress = {};
      const remoteDeleted = new Set();
      snap.forEach(d => {
        const v = d.data();
        if (d.id.startsWith("profile_")) remoteProfiles.push(v);
        if (d.id.startsWith("progress_")) remoteProgress[d.id.slice(9)] = v;
        if (d.id.startsWith("deleted_")) remoteDeleted.add(d.id.slice(8));
      });

      // Union tombstones from both sides, purge anything they cover.
      const deleted = new Set([...this._get("deleted", []), ...remoteDeleted]);
      this._set("deleted", [...deleted]);
      for (const id of deleted) {
        if (!remoteDeleted.has(id)) setDoc(doc(db, COL, "deleted_" + id), { id, at: Date.now() }).catch(() => {});
        this._remove("progress_" + id);
        delete remoteProgress[id];
      }
      for (const rp of remoteProfiles) {
        if (deleted.has(rp.id)) {
          deleteDoc(doc(db, COL, "profile_" + rp.id)).catch(() => {});
          deleteDoc(doc(db, COL, "progress_" + rp.id)).catch(() => {});
        }
      }
      remoteProfiles = remoteProfiles.filter(p => !deleted.has(p.id));

      // Merge profiles by id — the newer copy wins (PIN changes propagate).
      const local = this.getProfiles().filter(p => !deleted.has(p.id));
      const byId = new Map(local.map(p => [p.id, p]));
      let changed = local.length !== this.getProfiles().length;
      for (const rp of remoteProfiles) {
        const loc = byId.get(rp.id);
        if (!loc || (rp.updated || 0) > (loc.updated || 0)) { byId.set(rp.id, rp); changed = true; }
      }
      if (changed) this.saveProfiles([...byId.values()]);

      // Push local-only profiles/progress up so a fresh device sees them.
      const remoteIds = new Set(remoteProfiles.map(p => p.id));
      for (const p of byId.values()) {
        if (!remoteIds.has(p.id)) this._pushProfile(p);
        if (!remoteProgress[p.id]) this._pushProgress(p.id, this.getProgress(p.id));
      }

      // Merge progress with the game's rules (best score/stars/etc. wins).
      for (const [pid, remote] of Object.entries(remoteProgress)) {
        const localProg = this.getProgress(pid);
        const merged = cfg.mergeProgress(localProg, remote);
        merged.updated = Math.max(localProg.updated || 0, remote.updated || 0);
        this._set("progress_" + pid, merged);
        // Local had something the cloud lacked? Send the merged copy back up.
        if ((localProg.updated || 0) > (remote.updated || 0)) this._pushProgress(pid, merged);
      }
    },

    _pushProfile(p) {
      if (!this.fb) return;
      const { db, doc, setDoc } = this.fb;
      setDoc(doc(db, COL, "profile_" + p.id), p).catch(e => console.warn("sync profile failed", e));
    },

    // Debounced: progress lands in localStorage instantly (saveProgress), but
    // Firestore only sees it after PUSH_DELAY of quiet — so a run that banks a
    // coin per second costs one write, not hundreds.
    _pushProgress(pid, progress) {
      if (!this.fb) return;
      this._pending[pid] = progress;
      if (!this._pushTimer) this._pushTimer = setTimeout(() => this.flushProgress(), PUSH_DELAY);
    },

    // Push everything pending to Firestore now. Safe to call any time.
    flushProgress() {
      clearTimeout(this._pushTimer);
      this._pushTimer = null;
      const pending = this._pending;
      this._pending = {};
      if (!this.fb) return;
      const { db, doc, setDoc } = this.fb;
      for (const [pid, progress] of Object.entries(pending)) {
        setDoc(doc(db, COL, "progress_" + pid), progress).catch(e => console.warn("sync progress failed", e));
      }
    },
  };
};
