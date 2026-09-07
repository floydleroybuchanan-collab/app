import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
function load(path, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(mocks[name], name); return mocks[name]; }, ...globals });
  return exports;
}
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

function schedulerHarness({ forceOnStart = false, holdPreferences = null } = {}) {
  let now = 0, pathname = "/guide", surfing = false, cleanup;
  const calls = [], timers = [], refs = [];
  let refAt = 0, mounted = false;
  const prefs = { epgHours: 6, epgPastDays: 7, updateEpgOnAppStart: forceOnStart, updateEpgOnPlaylistChange: true };
  const api = load("src/components/SourceRefreshScheduler.tsx", {
    react: { useRef: value => refs[refAt++] ||= { current: value }, useEffect: (effect, deps) => {
      assert.equal(deps.length, 0, "navigation must not restart the scheduler");
      if (!mounted) { cleanup = effect(); mounted = true; }
    } },
    "react-native": { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } },
    "expo-router": { usePathname: () => pathname },
    "@/src/source": { refreshEpgOnly: async () => calls.push("forced-guide"), refreshSourcesIfDue: async () => calls.push("due-guide") },
    "@/src/nativeEpg": { consumeNativeScheduledEpgRefresh: async () => false, refreshNativeSourceGuide: async () => { throw Error("no custom source expected"); } },
    "@/src/core/multiEpgSources": { getMultiEpgSources: async () => [], updateMultiEpgRefreshStatus() {} },
    "@/src/utils/guideSurfGate": { isGuideSurfing: () => surfing },
    "@/src/core/sourceRefreshPreferences": { getSourceRefreshPreferences: async () => { calls.push("prefs"); if (holdPreferences) await holdPreferences; return prefs; } },
    "@/src/core/customEpgPolicy": { syncNativeCustomEpgPolicy: async () => {} },
    "@/src/core/playlistRegistry": { listPlaylists: async () => [{ id: "one", revision: "same" }], readCombinedPlaylists: async () => [], refreshPlaylists: async (_id, dueOnly) => { assert.equal(dueOnly, true); calls.push("due-playlist"); return []; } },
    "@/src/core/playlistEpg": { syncPlaylistEpg: async () => calls.push("bindings") },
    "@/src/source.native": { reloadPlaylistCatalog: async () => calls.push("reload") },
  }, { Date: { now: () => now }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 1; }, setInterval: (fn, ms) => { timers.push({ fn, ms }); return 2; }, clearTimeout() {}, clearInterval() {} });
  const render = () => { refAt = 0; api.SourceRefreshScheduler(); };
  render();
  return { calls, timers, cleanup: () => cleanup(), setSurfing: value => { surfing = value; },
    navigate: path => { pathname = path; render(); },
    tick: async (time, timer = 0) => { now = time; timers[timer].fn(); await settle(); } };
}

test("first eligible quiet-Guide check runs due-only work without a ten-minute startup gap", async () => {
  const h = schedulerHarness();
  await h.tick(29_999); assert.deepEqual(h.calls, []);
  await h.tick(30_000);
  assert.deepEqual(h.calls, ["prefs", "due-playlist", "due-guide"]);
  assert.equal(h.timers[1].ms, 60_000);
  assert.ok(!h.calls.includes("reload"), "fresh catalogs must not be republished");
  h.cleanup();
});

test("route changes do not repeat forced startup imports or reset the original timer", async () => {
  const h = schedulerHarness({ forceOnStart: true });
  h.navigate("/settings"); h.navigate("/guide");
  assert.equal(h.timers.length, 2);
  await h.tick(30_000);
  assert.equal(h.calls.filter(value => value === "forced-guide").length, 1);
  h.navigate("/epg-sources"); await h.tick(60_000, 1);
  assert.equal(h.calls.filter(value => value === "forced-guide").length, 1);
  assert.ok(h.calls.includes("due-guide"));
  h.cleanup();
});

test("active surfing and fullscreen delay new work but a slow preference read cannot queue duplicates", async () => {
  let release;
  const h = schedulerHarness({ holdPreferences: new Promise(resolve => { release = resolve; }) });
  h.setSurfing(true); await h.tick(30_000); assert.equal(h.calls.length, 0);
  h.setSurfing(false); h.navigate("/player"); await h.tick(60_000, 1); assert.equal(h.calls.length, 0);
  h.navigate("/guide"); await h.tick(120_000, 1); await h.tick(180_000, 1);
  assert.deepEqual(h.calls, ["prefs"]);
  release(); await settle();
  assert.deepEqual(h.calls, ["prefs", "due-playlist", "due-guide"]);
  h.cleanup();
});

test("late-mounted route target is resolved on each focus retry", () => {
  let node = null;
  const pending = [], requests = [];
  const api = load("src/utils/tvFocus.ts", { "react-native": {
    Platform: { isTV: true }, findNodeHandle: target => target.tag,
    UIManager: { dispatchViewManagerCommand: tag => requests.push(tag) },
  } }, { setTimeout: fn => { pending.push(fn); return pending.length; }, clearTimeout() {} });
  api.requestNativeFocusWithRetry(() => node, [0, 70], () => false);
  pending[0](); assert.deepEqual(requests, []);
  node = { tag: 42 }; pending[1](); assert.deepEqual(requests, [42]);
});

test("EPG Settings upward path includes All Settings and cannot restore a clipped scroll row", () => {
  const screen = read("app/(tabs)/epg-sources.tsx"), activity = read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
  assert.match(screen, /All Settings/);
  assert.doesNotMatch(screen, /<FocusGuide/);
  assert.match(screen, /removeClippedSubviews=\{false\}/);
  assert.match(screen, /focusable=\{false\}/);
  assert.doesNotMatch(activity, /page.getFocusables/);
  assert.match(activity, /TvFocusTraversal.targets/);
  assert.match(activity, /!\(view is ReactViewGroup && view.isTVFocusGuide\)/);
  assert.match(activity, /\{ usable\(currentFocus\) \}/);
  assert.match(activity, /\{ focus.requestFocus\(\) \}/);
});

test("health queries bypass guide downloads and the cache is not called unavailable because a refresh failed", () => {
  const native = read("android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt");
  for (const method of ["getPlaylistGuideHealth", "listUserGuideChannels", "listSourceGuideChannels", "searchSourceProgrammes"])
    assert.match(native, new RegExp(`fun ${method}[^\\n]+queryExecutor.execute`));
  const screen = read("app/(tabs)/epg-sources.tsx");
  assert.match(screen, /status.refreshing \? setInterval/);
  assert.match(screen, /if \(alive\)/);
  assert.doesNotMatch(screen, /status.error \? "Unavailable"/);
  assert.match(screen, /sum \+ item.indexedChannels/);
});

test("slow progress is informational, real failures remain errors, and completion publishes idle state", () => {
  const source = read("src/source.native.ts");
  const watchdog = source.match(/function onProgressStalled\(\)[\s\S]*?\n}/)[0];
  assert.doesNotMatch(watchdog, /phase: "error"|epgError:|persistMeta/);
  assert.match(source, /catch \(error\)[\s\S]*?setProgress\(\{ phase: "error"/);
  assert.equal((source.match(/refreshPromise = null;\n    emit\(\);/g) || []).length, 2);
  const due = source.match(/export async function refreshSourcesIfDue\([^\n]+[\s\S]*?\n}/)[0];
  assert.doesNotMatch(due, /refreshPlaylists|reloadPlaylistCatalog/);
  assert.match(due, /refreshEpgOnly\(false, canStartNext\)/);
});

test("Android guide store enables pooled WAL reads and keeps import swaps transactional", () => {
  const database = read("android/app/src/main/java/com/charmiptv/app/EpgDatabase.kt");
  assert.match(database, /init \{[\s\S]*?setWriteAheadLoggingEnabled\(true\)/);
  const swap = database.match(/fun replaceBatches\([\s\S]*?\n  fun queryWindow/)[0];
  assert.doesNotMatch(swap, /db.beginTransaction\(\)/);
  assert.match(swap, /db.beginTransactionNonExclusive\(\)/);
  assert.match(swap, /db.setTransactionSuccessful\(\)/);
  assert.match(swap, /finally \{ db.endTransaction\(\) \}/);
  assert.match(swap, /Refusing to replace live EPG with an empty feed/);
});
