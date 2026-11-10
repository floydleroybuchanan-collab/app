import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (name) => readFile(join(root, name), "utf8");

test("BACK from VOD roots opens the existing Charming main drawer without leaving MainActivity", async () => {
  const [root, manager, host, main] = await Promise.all([
    source("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt"),
    source("app/(tabs)/vod.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);
  assert.match(root, /fun navigateBack\(\): Boolean/);
  assert.match(root, /R\.id\.genre_hub, R\.id\.platforms -> \{/);
  assert.match(root, /onHostBack\?\.invoke\(\)/);
  assert.match(root, /player\?\.onBackPressed\(\) == true/);
  assert.match(root, /controller\.navigateUp\(\)/);
  assert.match(manager, /CharmVodRootBack/);
  assert.match(host, /DeviceEventEmitter\.addListener\("CharmVodRootBack", \(\) => openDrawer/);
  assert.match(main, /nativeVodOwnsFocus\(\)/);
});

test("VOD LEFT reaches icon rail only at content or first action boundary", async () => {
  const [focus, glass] = await Promise.all([
    source("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodFocusCoordinator.kt"),
    source("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodGlassActionBar.kt"),
  ]);
  assert.match(focus, /if \(key == KeyEvent\.KEYCODE_DPAD_LEFT\)/);
  assert.match(focus, /isFirstActionFocused\(current\)/);
  // inContent was computed with a non-null content root; no duplicate null guard is needed.
  assert.match(focus, /if \(inContent\)/);
  assert.match(focus, /val inContent = content != null && VodFocusMemory\.isWithin\(content, current\)/);
  assert.match(focus, /findNextFocus|focusSearch\(View\.FOCUS_LEFT\)/);
  assert.match(focus, /onHostRailFocus\?\.invoke\(\) == true/);
  assert.doesNotMatch(focus, /binding\.navMain(?!Fragment)/);
  assert.match(focus, /KEYCODE_DPAD_DOWN/);
  assert.match(focus, /KEYCODE_DPAD_UP/);
  assert.match(glass, /scaleX\(if \(focused\) 1\.08f else 1f\)/);
});

test("Guide BACK and left edge reopen groups at remembered focus", async () => {
  const [guide, groupDrawer, native, hook, shell] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/PurpleGuideGroupDrawer.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
    source("src/hooks/use-tv-back-to-guide.ts"),
    source("src/components/PurpleTvShell.tsx"),
  ]);
  assert.match(guide, /setGroupDrawerOpen\(true\);\s*return true/);
  assert.match(guide, /onGuideLeftBoundary/);
  assert.match(guide, /openDrawer\(\{ force: true \}\)/);
  assert.match(groupDrawer, /lastFocusedGuideGroupName = item\.name/);
  assert.match(groupDrawer, /focusTargetNameRef\.current/);
  assert.match(native, /emit\("topLeftBoundary", null\)/);
  assert.match(hook, /BackHandler\.addEventListener\("hardwareBackPress", onBack\)/);
  assert.doesNotMatch(hook, /GUIDE_DOUBLE_BACK_WINDOW_MS/);
  assert.match(shell, /isGuideSurfing\(\) && !options\?\.force/);
  assert.match(native, /val gridBottom = min\(height\.toFloat\(\), headerHeight \+ drawnRows \* rowHeight\)/);
});
