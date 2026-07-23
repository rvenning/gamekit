"use strict";
// Data-safety tests for gk-storage.js — the shared persistence + family-sync
// core. These cover the behaviours that, if they regress, silently corrupt the
// kids' saved progress: tombstoned deletes (a removed profile must never come
// back), the cross-device progress merge (never lose a best score or a field),
// and the debounced write path (never drop a queued write).
//
//   cd gamekit && node --test
//
// The gk-* files are browser scripts (they hang everything off a `window.GK`
// global and use localStorage/Firestore), so we run them in a vm sandbox with
// a fake localStorage and a mock Firestore backing store.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../tools/test-harness.js");

const GK_DIR = path.join(__dirname, "..", "gk");

// Fresh sandbox per call so tests don't share GK state or localStorage. The
// browser sandbox supplies window/localStorage/document and an unref'd
// setTimeout, so a pending 3s debounce timer can't keep `node --test` alive.
function loadGamekit() {
  return loadScripts({ baseDir: GK_DIR, files: ["gk-util.js", "gk-storage.js"], browser: true }).GK;
}

// The contract every game's merge should follow: keep the best of each numeric
// field, and preserve keys this version doesn't know about.
function makeConfig(overrides = {}) {
  return Object.assign({
    prefix: "t",
    collection: "testcol",
    firebaseConfig: null,
    blankProgress: () => ({ best: 0, coins: 0, updated: 0 }),
    mergeProgress: (a, b) => ({
      ...a, ...b,
      best: Math.max(a.best || 0, b.best || 0),
      coins: Math.max(a.coins || 0, b.coins || 0),
    }),
  }, overrides);
}

// Mock Firestore: a plain object keyed by doc id, mutated synchronously so
// assertions can read it straight after a _syncDown / flush.
function makeFb(remote = {}) {
  const store = { ...remote };
  const fb = {
    db: {},
    collection: (_db, col) => ({ col }),
    getDocs: async () => ({
      forEach: (cb) => Object.entries(store).forEach(([id, data]) => cb({ id, data: () => data })),
    }),
    doc: (_db, _col, id) => ({ id }),
    setDoc: async (ref, val) => { store[ref.id] = val; },
    deleteDoc: async (ref) => { delete store[ref.id]; },
  };
  return { fb, store };
}

test("local persistence: profiles, progress and settings round-trip", () => {
  const S = loadGamekit().createStorage(makeConfig());
  const p = S.addProfile("Rosalie", "🦄", "1234");
  assert.equal(S.getProfiles().length, 1);
  assert.equal(S.getProfiles()[0].name, "Rosalie");
  S.saveProgress(p.id, { best: 12, coins: 3, updated: 0 });
  assert.equal(S.getProgress(p.id).best, 12);
  assert.equal(S.getSettings().sound, true);
  const s = S.getSettings(); s.sound = false; S.saveSettings(s);
  assert.equal(S.getSettings().sound, false);
});

test("deleteProfile wipes progress and records a tombstone", () => {
  const S = loadGamekit().createStorage(makeConfig());
  const p = S.addProfile("Gone", "🐸", null);
  S.saveProgress(p.id, { best: 5, updated: 0 });
  S.deleteProfile(p.id);
  assert.equal(S.getProfiles().find((x) => x.id === p.id), undefined);
  assert.equal(S.getProgress(p.id).best, 0, "progress reset to blank");
  assert.ok(S._get("deleted", []).includes(p.id), "tombstone recorded locally");
});

// Anonymous auth gates Firestore access once the rules require request.auth.
// The rollout is code-first, rules-second, so the failure path matters as much
// as the success path: a build that hard-failed when the Anonymous provider
// wasn't enabled yet would take every game offline the moment it shipped.
function makeAuthMod({ fail = false, uid = "anon-123" } = {}) {
  return {
    getAuth: () => ({ currentUser: fail ? null : { uid } }),
    signInAnonymously: async () => {
      if (fail) { const e = new Error("auth/operation-not-allowed"); e.code = "auth/operation-not-allowed"; throw e; }
      return { user: { uid } };
    },
  };
}

test("anonymous sign-in records the uid", async () => {
  const S = loadGamekit().createStorage(makeConfig());
  const ok = await S.signInAnon(makeAuthMod(), {});
  assert.equal(ok, true);
  assert.equal(S.authed, true);
  assert.equal(S.uid, "anon-123");
});

test("a disabled Anonymous provider must not throw — sync degrades, it doesn't crash", async () => {
  const S = loadGamekit().createStorage(makeConfig());
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  let threw = null;
  try { await S.signInAnon(makeAuthMod({ fail: true }), {}); }
  catch (e) { threw = e; }
  finally { console.warn = realWarn; }

  assert.equal(threw, null, "sign-in failure must be swallowed, not propagated");
  assert.equal(S.authed, false);
  assert.equal(S.uid, null);
  assert.ok(warnings.some(w => w.includes("anonymous auth unavailable")), "and it should say so loudly");
});

test("a stale remote cannot resurrect a deleted profile", async () => {
  const S = loadGamekit().createStorage(makeConfig());
  const p = S.addProfile("Isabelle", "🦄", null);
  const id = p.id;
  S.deleteProfile(id); // local tombstone
  // another device that never saw the delete still has the docs in Firestore
  const { fb, store } = makeFb({
    ["profile_" + id]: { id, name: "Isabelle", avatar: "🦄", updated: 1 },
    ["progress_" + id]: { best: 99, updated: 1 },
  });
  S.fb = fb;
  await S._syncDown();
  assert.equal(S.getProfiles().find((x) => x.id === id), undefined, "stays deleted locally");
  assert.equal(store["profile_" + id], undefined, "remote profile purged");
  assert.equal(store["progress_" + id], undefined, "remote progress purged");
  assert.ok(store["deleted_" + id], "tombstone pushed to remote");
});

test("a remote tombstone deletes a profile that is still local", async () => {
  const S = loadGamekit().createStorage(makeConfig());
  const p = S.addProfile("Zombie", "🐼", null);
  const id = p.id;
  const { fb } = makeFb({ ["deleted_" + id]: { id, at: 1 } });
  S.fb = fb;
  await S._syncDown();
  assert.equal(S.getProfiles().find((x) => x.id === id), undefined, "removed by remote tombstone");
});

test("sync merges progress: keeps the best and preserves unknown keys", async () => {
  const S = loadGamekit().createStorage(makeConfig());
  const p = S.addProfile("Merge", "🦊", null);
  const id = p.id;
  S.saveProgress(id, { best: 5, coins: 2, badge: "gold", updated: 1 });
  const { fb } = makeFb({
    ["profile_" + id]: { id, name: "Merge", avatar: "🦊", updated: 1 },
    ["progress_" + id]: { best: 9, coins: 1, updated: 2 },
  });
  S.fb = fb;
  await S._syncDown();
  const merged = S.getProgress(id);
  assert.equal(merged.best, 9, "higher best kept");
  assert.equal(merged.coins, 2, "higher coins kept");
  assert.equal(merged.badge, "gold", "unknown key preserved (no data loss)");
});

test("a newer remote profile wins by `updated` (e.g. a PIN change propagates)", async () => {
  const S = loadGamekit().createStorage(makeConfig());
  const p = S.addProfile("Old", "🐨", null);
  const id = p.id;
  const locals = S.getProfiles(); locals[0].updated = 1; S.saveProfiles(locals); // force local older
  const { fb } = makeFb({
    ["profile_" + id]: { id, name: "Newer", avatar: "🐨", pin: "1111", updated: 9e12 },
  });
  S.fb = fb;
  await S._syncDown();
  const got = S.getProfiles().find((x) => x.id === id);
  assert.equal(got.name, "Newer");
  assert.equal(got.pin, "1111");
});

test("debounced writes coalesce, and flush pushes the latest value", async () => {
  const S = loadGamekit().createStorage(makeConfig());
  const p = S.addProfile("Buff", "🐷", null);
  const { fb, store } = makeFb();
  S.fb = fb;
  S.saveProgress(p.id, { best: 1, updated: 0 });
  S.saveProgress(p.id, { best: 2, updated: 0 });
  S.saveProgress(p.id, { best: 3, updated: 0 });
  assert.equal(Object.keys(S._pending).length, 1, "three saves coalesced to one pending doc");
  assert.equal(store["progress_" + p.id], undefined, "nothing pushed yet (debounced)");
  S.flushProgress();
  await Promise.resolve();
  assert.equal(store["progress_" + p.id].best, 3, "latest value pushed on flush");
  assert.equal(Object.keys(S._pending).length, 0, "pending queue cleared");
});

test("a queued push cannot resurrect a just-deleted profile", async () => {
  const S = loadGamekit().createStorage(makeConfig());
  const p = S.addProfile("Race", "🦁", null);
  const { fb, store } = makeFb();
  S.fb = fb;
  S.saveProgress(p.id, { best: 7, updated: 0 }); // queues a push
  S.deleteProfile(p.id);                          // must drop the queued push
  S.flushProgress();
  await Promise.resolve();
  assert.equal(store["progress_" + p.id], undefined, "no resurrected progress doc");
});

// ---- mergeProgress contract (order-independent + lossless) ----
// `updated` is exempt from order-independence: it's a reserved timestamp that
// gk-storage overwrites with Math.max(a.updated, b.updated) AFTER the game's
// mergeProgress runs, so the merge itself needn't reconcile it commutatively.
function assertOrderIndependentAndLossless(merge, a, b) {
  const ab = merge({ ...a }, { ...b });
  const ba = merge({ ...b }, { ...a });
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    assert.ok(k in ab, `merge dropped key "${k}"`);
    if (k === "updated") continue;
    assert.deepEqual(ab[k], ba[k], `merge not order-independent for key "${k}"`);
  }
}

test("mergeProgress contract: representative max-merge is order-independent and lossless", () => {
  const merge = makeConfig().mergeProgress;
  assertOrderIndependentAndLossless(
    merge,
    { best: 5, coins: 2, badge: "x", updated: 1 },
    { best: 9, coins: 1, updated: 2 },
  );
});

test("mergeProgress contract: score-season (sver) merge retires old scores safely", () => {
  // mirrors Block Party: bumping the season must retire old scores even though
  // the sync merges by max — the newer season wins wholesale.
  const merge = (a, b) => {
    const sa = a.sver || 1, sb = b.sver || 1;
    if (sa !== sb) return sb > sa ? { ...b } : { ...a };
    return { ...a, ...b, best: Math.max(a.best || 0, b.best || 0), sver: sa };
  };
  // same season behaves like a normal lossless max-merge
  assertOrderIndependentAndLossless(merge, { best: 5, sver: 2 }, { best: 9, sver: 2 });
  // a high old-season score cannot come back once the season is bumped
  assert.equal(merge({ best: 0, sver: 2 }, { best: 470, sver: 1 }).best, 0);
  assert.equal(merge({ best: 470, sver: 1 }, { best: 0, sver: 2 }).best, 0);
});
