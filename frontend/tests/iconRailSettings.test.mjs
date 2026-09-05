import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../src/core/iconRailPolicy.ts";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("rail offers every requested minute plus Never Leaves and defaults to three minutes", () => {
  assert.deepEqual(policy.ICON_RAIL_TIMEOUT_OPTIONS.map(option => option.value), [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  assert.equal(policy.ICON_RAIL_TIMEOUT_OPTIONS.at(-1).label, "Never Leaves");
  assert.deepEqual(policy.normalizeIconRailPreferences(null), { enabled: true, timeoutMinutes: 3 });
  assert.deepEqual(policy.normalizeIconRailPreferences({ enabled: false, timeoutMinutes: 0 }), { enabled: false, timeoutMinutes: 0 });
  assert.equal(policy.normalizeIconRailPreferences({ timeoutMinutes: 200 }).timeoutMinutes, 3);
});

test("idle timeout restarts after interaction, clamps clock changes and never expires in Never Leaves mode", () => {
  assert.equal(policy.railIdleRemainingMs(1, 0, 59_999), 1);
  assert.equal(policy.railIdleRemainingMs(1, 0, 60_000), 0);
  assert.equal(policy.railIdleRemainingMs(1, 59_999, 60_000), 59_999);
  assert.equal(policy.railIdleRemainingMs(9, 100, 0), 540_000);
  assert.equal(policy.railIdleRemainingMs(0, 0, 999_999_999), null);
});

test("rail preferences serialize rapid edits, preserve startup hydration and do not publish failed saves", async () => {
  const exports = {}; let finishLoad, fail = false; const saved = [];
  const hydrated = new Promise(resolve => { finishLoad = resolve; });
  const mocks = {
    react: { useEffect() {}, useState() {} }, "./iconRailPolicy": policy,
    "@/src/utils/storage": { storage: { getItem: () => hydrated, setItem: async (key, value) => {
      assert.equal(key, "gs_icon_rail_preferences_v1"); if (fail) return false; saved.push(value); return true;
    } } },
  };
  const code = ts.transpileModule(read("src/core/iconRailPreferences.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name] });
  const first = exports.saveIconRailPreferences({ enabled: false });
  const second = exports.saveIconRailPreferences({ timeoutMinutes: 8 });
  finishLoad({ enabled: true, timeoutMinutes: 2 });
  await Promise.all([first, second]);
  assert.deepEqual(saved.at(-1), { enabled: false, timeoutMinutes: 8 });
  fail = true; await assert.rejects(exports.saveIconRailPreferences({ enabled: true }), /Could not save/);
  assert.equal((await exports.getIconRailPreferences()).enabled, false);
});

test("rail timeout waits for a safe native page focus handoff and preserves Guide's separate boundary", () => {
  const shell = read("src/components/PurpleTvShell.tsx");
  const activity = read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
  assert.match(shell, /railPreferences.enabled && !railTimedOut && !drawerOpen/);
  assert.match(shell, /active !== "\/guide" \|\| Boolean\(secondaryDrawer\)/);
  assert.match(shell, /await prepareIconRailHide\(tag\)/);
  assert.match(shell, /safeToHide && observedActivity === lastRailInteractionRef.current/);
  assert.match(shell, /if \(cancelled\) return/);
  assert.match(shell, /if \(!railPreferences.enabled\)[\s\S]{0,100}openDrawer\(\)/);
  assert.match(activity, /if \(!within\(focus, rail\)\) return true/);
  assert.match(activity, /return focusContentFromRail\(root, rail, focus\)/);
  assert.match(activity, /emitRemoteEvent\("CharmIconRailReveal", root.id.toString\(\)\)/);
  assert.match(activity, /if \(guidePage != null\) emitRemoteEvent\("CharmGuideGroupsRequestOpen"/);
});

test("all Settings tiles resolve to a focus-owned section or a reviewed independent route", () => {
  const settings = read("app/(tabs)/settings.tsx");
  const tiles = settings.match(/const TILES: Tile\[\] = \[([\s\S]*?)\n\];/)?.[1] || "";
  const sections = Array.from(tiles.matchAll(/id: "([^"]+)"/g), match => match[1]);
  assert.equal(sections.length, 13);
  for (const section of sections) {
    if (section === "epg" || section === "playlists") continue;
    assert.ok(settings.includes(`section === "${section}"`), `${section} must have an in-page destination`);
  }
  assert.match(settings, /tileEntryFocus.preferredFocus && index === 0/);
  assert.match(settings, /detailEntryFocus.preferredFocus/);
  const routes = ["app/playlists.tsx", "app/(tabs)/epg-sources.tsx", "app/epg-source.tsx", "app/epg-custom.tsx", "app/group-settings.tsx"];
  for (const route of routes) {
    const body = read(route);
    assert.match(body, /<PurpleTvShell active="\/settings"/, route);
    assert.match(body, /hasTVPreferredFocus=\{entryFocus.preferredFocus\}/, route);
    assert.match(body, /nextFocusLeft=\{iconRailEntryTag\}/, route);
    assert.match(body, /onFocus=\{entryFocus.onFocus\}/, route);
    assert.match(body, /<ScrollView/, route);
  }
});

test("Settings fields have visible focus and assignment/dropdown overlays restore a live page control", () => {
  for (const path of ["app/(tabs)/settings.tsx", "app/playlists.tsx", "app/epg-source.tsx", "app/epg-custom.tsx", "app/group-settings.tsx"]) {
    assert.match(read(path), /TvSettingsTextInput as TextInput/, path);
  }
  assert.match(read("src/components/TvSettingsTextInput.tsx"), /focused && \{ borderColor: "#fff"/);
  const picker = read("src/components/EpgChannelAssignDrawer.tsx");
  assert.match(picker, /focusable=\{false\} style=\{styles.backdrop\}/);
  assert.match(picker, /focusable=\{false\} style=\{styles.card\}/);
  assert.match(picker, /requestAnimationFrame\(returnToPage\)/);
  assert.match(picker, /setRemoteContext\("modal"\)/);
  const menu = read("src/components/IconRailSettings.tsx");
  assert.match(menu, /<Modal visible=\{open\}.*onRequestClose=\{close\}/);
  assert.match(menu, /onFocus=\{\(\) => setPreferSelectedFocus\(false\)\}/);
  assert.match(menu, /trapFocusUp trapFocusDown trapFocusLeft trapFocusRight/);
});

test("inactive retained routes cannot publish rail destinations or claim drawer focus", () => {
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(shell, /if \(!isFocused \|\| !showIconRail\)[\s\S]{0,80}publishIconRailEntryTag/);
  assert.match(shell, /if \(!isFocused\) \{[\s\S]{0,140}railRevealPendingRef.current = false/);
  assert.match(shell, /if \(!isFocused \|\| !drawerOpen\) return/);
  assert.match(shell, /if \(!isFocused \|\| !drawerOpen\) \{[\s\S]{0,80}setDrawerAutoFocus\(false\)/);
});

test("disabled-only guide sources avoid automatic downloads and an empty Guide retains navigation", () => {
  const background = read("android/app/src/main/java/com/charmiptv/app/BackgroundEpgUpdater.kt");
  assert.match(background, /effectiveBindings\(sourceId\).filter \{ it.channelId in activeChannelIds \}/);
  assert.ok(background.indexOf("if (activeIds.isEmpty()) return") < background.indexOf("val batches = stream("));
  assert.match(read("src/components/SourceRefreshScheduler.tsx"), /!usedSources.has\(source.id\).*activeChannelIds.has\(id\)/);
  assert.match(read("src/components/PurpleGuideGroupDrawer.tsx"), /No enabled playlists/);
  assert.match(read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"), /if \(rows.isEmpty\(\)\) \{\s*if \(keyCode == KeyEvent.KEYCODE_DPAD_LEFT\) \{ emit\("topLeftBoundary"/);
});

test("secondary pages do not expire initial focus on an arbitrary timer and Reminders measures available space", () => {
  for (const path of ["app/(tabs)/channels.tsx", "app/(tabs)/favorites.tsx", "app/(tabs)/search.tsx", "app/(tabs)/reminders.tsx", "src/components/PurpleChannelCollection.tsx", "src/components/PurpleGuideGroupDrawer.tsx"]) {
    assert.doesNotMatch(read(path), /setTimeout\(\(\) => setPrefer\w+Focus\(false\)/, path);
  }
  const reminders = read("app/(tabs)/reminders.tsx");
  assert.match(reminders, /setContentWidth\(event.nativeEvent.layout.width\)/);
  assert.match(reminders, /Math.floor\(\(contentWidth - pagePad/);
  assert.match(reminders, /requestNativeFocus\(entryFocus.targetRef.current\);\s*void removeReminder\(key\)/);
  const groups = read("src/components/PurpleGuideGroupDrawer.tsx");
  assert.match(groups, /\(\) => focusConfirmedRef.current/);
  assert.match(groups, /focusConfirmedRef.current = true;\s*setPreferActiveFocus\(false\)/);
});

test("preview retries stop only after native acquisition, a newer request, or unmount", () => {
  const exports = {}, calls = []; let canceled = 0;
  const code = ts.transpileModule(read("src/utils/guidePreviewFocus.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ requestNativeFocusWithRetry: (node, delays, confirmed) => {
    calls.push({ node, confirmed }); return () => { canceled++; };
  } }) });
  const node = {};
  exports.registerGuidePreviewNode("play", node, true);
  assert.equal(exports.focusGuidePreviewSurface(), true);
  assert.equal(calls[0].confirmed(), false);
  exports.noteGuidePreviewFocus(node);
  assert.equal(calls[0].confirmed(), true);
  assert.equal(canceled, 1);
  exports.focusGuidePreviewSurface();
  assert.equal(calls[1].confirmed(), false);
  exports.focusGuidePreviewSurface();
  assert.equal(canceled, 2);
  exports.registerGuidePreviewNode("play", null);
  assert.equal(canceled, 3);
  assert.equal(exports.focusGuidePreviewSurface(), false);
});
