// gamekit · gk-pwa.js — service worker registration + "Add to Home Screen".
// Extracted from WordVoyage js/pwa.js / Chicken Cross (identical).
//
//   GK.initPWA({ appName: "My Game" });   // call once, any time after DOM ready
//
// Chrome (desktop & Android) fires `beforeinstallprompt` when the app is
// installable; we stash that event, reveal #btn-install, and call prompt()
// on click. iOS Safari never fires it, so there the button opens
// share-menu instructions (modal injected by this module). The button
// never shows when already running installed.
window.GK = window.GK || {};

GK.initPWA = function ({ appName = "this game", swPath = "sw.js", buttonId = "btn-install", version = true } = {}) {
  if ("serviceWorker" in navigator) {
    // Relative path keeps the scope correct under GitHub Pages subpaths.
    navigator.serviceWorker.register(swPath).catch((e) => console.warn("SW registration failed:", e));
  }
  if (version) GK.Version.mount(typeof version === "object" ? version : {});

  const btn = document.getElementById(buttonId);
  if (!btn) return;

  GK.UI.inject(`
<div class="modal" id="gk-ios-install-modal">
  <div class="sheet">
    <h2>📲 Add to Home Screen</h2>
    <p style="text-align:left">iPhones and iPads install web apps from Safari's share menu:</p>
    <ol style="text-align:left;line-height:1.7;margin:10px 0 16px;padding-left:22px">
      <li>Tap the <b>Share</b> button in Safari's toolbar</li>
      <li>Scroll down and tap <b>Add to Home Screen</b></li>
      <li>Tap <b>Add</b> — ${GK.util.esc(appName)} runs fullscreen like a real app!</li>
    </ol>
    <button class="btn blue wide" onclick="GK.UI.closeModal('gk-ios-install-modal')">Got it</button>
  </div>
</div>`);

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true; // iOS Safari's non-standard flag

  // iPadOS 13+ reports as MacIntel, hence the maxTouchPoints check.
  const isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // suppress Chrome's mini-infobar; we show our own button
    deferredPrompt = e;
    if (!isStandalone) btn.style.display = "";
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    btn.style.display = "none";
  });

  if (isIos && !isStandalone) btn.style.display = "";

  btn.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      // Single-use either way; Chrome may re-fire beforeinstallprompt later.
      deferredPrompt = null;
      if (outcome === "accepted") btn.style.display = "none";
    } else if (isIos) {
      GK.UI.openModal("gk-ios-install-modal");
    }
  });
};

// ---------------------------------------------------------------------------
// GK.Version — "Version 12 · 14 Sep 2026" on the home screen, and whether a
// newer build is live.
//
// A game's version is its sw.js cache number (`mygame-v12` -> 12), bumped on
// every deploy. `node lib/tools/stamp-version.js . --bump` bumps it and writes
// it into index.html (<meta name="gk-version">, the running build) and
// version.json (the deployed build). GK.initPWA() mounts the line at the
// bottom of the screen that is showing at start-up; pass
// `version: { target: el }` to put it elsewhere or `version: false` to skip.
GK.Version = (() => {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** The build this page was loaded from, or null for a game not yet stamped. */
  function running(doc = document) {
    const meta = doc.querySelector('meta[name="gk-version"]');
    const v = meta ? Number(meta.getAttribute("content")) : NaN;
    if (!Number.isFinite(v)) return null;
    return { version: v, date: meta.getAttribute("data-date") || "", kit: meta.getAttribute("data-kit") || "" };
  }

  /** "Version 12 · 14 Sep 2026" */
  function label(info) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(info.date || "");
    const day = m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
    return [`Version ${info.version}`, day].filter(Boolean).join(" · ");
  }

  /** The deployed build, or null when offline or unknown. Cache-busted so no layer answers from memory. */
  async function fetchLatest(url = "version.json") {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return null;
      const info = await res.json();
      return Number.isFinite(info.version) ? info : null;
    } catch {
      return null;
    }
  }

  /** Pick up the new build: let the service worker refresh, then reload. */
  async function update() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        const changed = new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
        await reg.update();
        await Promise.race([changed, new Promise((r) => setTimeout(r, 3000))]);
      }
    } catch { /* reload regardless */ }
    location.reload();
  }

  /** Add the version line to the home screen and check for a newer build. Returns the element, or null. */
  function mount({ target = null, url = "version.json" } = {}) {
    const info = running();
    if (!info) return null;
    const host = target || document.getElementById("gk-version") ||
      document.querySelector(".screen.active") || document.body;
    const el = document.createElement("p");
    el.className = "gk-version";
    if (info.kit) el.title = `gamekit ${info.kit}`;
    const text = document.createElement("span");
    text.textContent = label(info);
    const status = document.createElement("span");
    status.className = "gk-version-status";
    status.setAttribute("aria-live", "polite");
    el.append(text, status);
    host.appendChild(el);
    fetchLatest(url).then((latest) => {
      if (!latest) return;
      if (latest.version <= info.version) {
        status.textContent = "✓ Latest";
        status.classList.add("ok");
        return;
      }
      const btn = document.createElement("button");
      btn.className = "btn gk-version-update";
      btn.textContent = `Update to ${latest.version}`;
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "Updating…";
        update();
      });
      status.replaceChildren(btn);
    });
    return el;
  }

  return { running, label, fetchLatest, update, mount };
})();
