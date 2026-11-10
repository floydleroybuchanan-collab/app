import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const native = read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
const shell = read("src/components/PurpleTvShell.tsx");
const vod = read("app/(tabs)/vod.tsx");
const rootFragment = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt");
const settings = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/SettingsTvFragment.kt");

test("native VOD receives unhandled remote arrows and playback controls exclusively", () => {
  assert.match(native, /if \(nativeVodOwnsFocus\(\) && vodKeyHandler\?\.invoke\(event\) == true\)/);
  assert.match(native, /if \(nativeVodOwnsFocus\(\)\) return super\.dispatchKeyEvent\(event\)/);
  const exclusive = native.indexOf("if (nativeVodOwnsFocus()) return super.dispatchKeyEvent(event)");
  assert.ok(exclusive > native.indexOf("vodKeyHandler?.invoke(event)"));
  assert.ok(exclusive < native.indexOf("if (routeShellBoundary(event))"));
  assert.ok(exclusive < native.indexOf("val mirrorToJs ="));
});

test("a visually closed main drawer retires its native focus guide after the normal animation", () => {
  assert.match(shell, /const \[drawerRendered, setDrawerRendered\] = useState\(drawerOpen\)/);
  assert.match(shell, /setTimeout\(\(\) => setDrawerRendered\(false\), PURPLE_DRAWER_ANIMATION_MS\)/);
  assert.match(shell, /return \(\) => clearTimeout\(remove\)/);
  assert.match(shell, /\{isFocused && drawerRendered \?/);
  assert.match(shell, /trapFocusRight=\{drawerOpen && active !== "\/vod"\}/);
  assert.match(shell, /pointerEvents=\{drawerOpen \? "auto" : "none"\}/);
});

test("native mount error retry is DPAD-selectable without a mouse or unlimited focus loop", () => {
  assert.match(vod, /ref=\{retryButtonRef\}/);
  assert.match(vod, /hasTVPreferredFocus/);
  assert.match(vod, /focusable/);
  assert.match(vod, /onFocus=\{\(\) => \{ retryFocusedRef\.current = true; \}\}/);
  assert.match(vod, /requestNativeFocusWithRetry/);
  assert.match(vod, /\[0, 80, 180, 360, 650\]/);
});

test("nested Settings back stack uses the existing VOD/Activity owner rather than a competing callback", () => {
  assert.doesNotMatch(settings, /OnBackPressedCallback|onBackPressedDispatcher|settingsBackCallback/);
  assert.match(settings, /fun navigateBackWithinSettings\(\): Boolean/);
  assert.match(settings, /if \(screenBackStack\.isEmpty\(\)\) return false/);
  assert.match(rootFragment, /settings\?\.navigateBackWithinSettings\(\) == true/);
  assert.match(rootFragment, /R\.id\.home, R\.id\.settings/);
});

test("VOD startup shows focus-neutral branded loading until actual destination readiness", () => {
  assert.match(vod, /ActivityIndicator/);
  assert.match(vod, /const \[nativeReady, setNativeReady\] = useState\(false\)/);
  assert.match(vod, /setNativeReady\(true\)/);
  assert.match(vod, /isFocused && !mountError && !nativeReady/);
  assert.match(vod, /pointerEvents="none"/);
  assert.match(vod, /setNativeReady\(false\)/);
});
