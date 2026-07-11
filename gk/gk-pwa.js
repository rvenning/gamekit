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

GK.initPWA = function ({ appName = "this game", swPath = "sw.js", buttonId = "btn-install" } = {}) {
  if ("serviceWorker" in navigator) {
    // Relative path keeps the scope correct under GitHub Pages subpaths.
    navigator.serviceWorker.register(swPath).catch((e) => console.warn("SW registration failed:", e));
  }

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
