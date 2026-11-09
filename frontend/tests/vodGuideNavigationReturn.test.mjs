import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (name) => readFile(join(root, name), "utf8");

test("VOD root BACK opens the single Charming MediaLab drawer; nested pages navigate up", async () => {
  const [embedded, host, bridge] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/CharmEmbeddedVodView.kt"),
    source("app/(tabs)/vod.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt"),
  ]);
  assert.match(embedded, /private fun handleBack\(\)/);
  assert.match(embedded, /fragment is PlayerTvFragment &&/);\n  assert.match(embedded, /fragment\.view != null/);\n  assert.match(embedded, /if \(!playerHandled && !nav\.navigateUp\(\)\) event\("topRequestMainDrawer"\)/);
  assert.match(embedded, /event\("topRequestMainDrawer"\)/);
  assert.match(host, /openDrawer\(\{ force: true \}\)/);
  assert.match(host, /onRequestMainDrawer=\{openMainDrawer\}/);
  assert.match(bridge, /CharmVodViewManager/);
  assert.doesNotMatch(host, /NativeModules\.CharmVod|startActivityForResult/);
});

test("VOD LEFT uses the same app rail and preserved focus, never a private VOD rail", async () => {
  const [embedded, host, glass] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/CharmEmbeddedVodView.kt"),
    source("app/(tabs)/vod.tsx"),
    source("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodGlassActionBar.kt"),
  ]);
  assert.match(embedded, /focus\.focusSearch\(View\.FOCUS_LEFT\)/);
  assert.match(embedded, /event\("topRequestIconRail"\)/);
  assert.match(embedded, /focusMemory\.restore\(destination, fragmentContainer\)/);
  assert.match(host, /focusIconRail\(\)/);
  assert.match(host, /onRequestIconRail=\{openSharedRail\}/);
  assert.match(glass, /scaleX\(if \(hasFocus\) 1\.10f else 1f\)/);
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
