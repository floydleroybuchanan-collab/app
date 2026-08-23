import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("Guide BACK requires a fresh double-press for each drawer layer", async () => {
  const [hook, guide, groups, activity] = await Promise.all([
    source("src/hooks/use-tv-back-to-guide.ts"),
    source("app/(tabs)/guide.tsx"),
    source("src/components/PurpleGuideGroupDrawer.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt"),
  ]);
  assert.match(hook, /GUIDE_DOUBLE_BACK_WINDOW_MS = 650/);
  assert.match(hook, /pathname\?\.startsWith\("\/guide"\)/);
  assert.match(hook, /lastGuideBackAtRef\.current = now;\s*return true/);
  assert.match(hook, /lastGuideBackAtRef\.current = 0;\s*}\s*return onBack\(\)/);
  assert.match(guide, /if \(groupDrawerOpen\) \{\s*setGroupDrawerOpen\(false\);\s*openDrawer\(\);\s*return true;\s*}/);
  assert.match(guide, /setGroupDrawerOpen\(true\);\s*return true/);
  assert.doesNotMatch(groups, /key === "LEFT" \|\| key === "BACK"/);
  assert.match(groups, /if \(key === "LEFT"\)/);
  assert.match(activity, /context == "guide_groups" && \(boundaryKey == "LEFT" \|\| boundaryKey == "RIGHT"\)/);
  assert.doesNotMatch(activity, /context == "guide_groups" && boundaryKey != null/);
});

test("returning from fullscreen restores the selected Guide group and channel instead of All", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /let guideSessionGroup = "All"/);
  assert.match(guide, /guideSessionGroup = group;\s*guideSessionChannelId = channel\.id;\s*rememberGuideGroupChannel\(group, channel\.id\);/);
  assert.match(guide, /if \(guideSessionChannelId \|\| guideSessionGroup !== "All"\) \{\s*if \(group !== guideSessionGroup\) setGroup\(guideSessionGroup\);\s*return;\s*}/);
  assert.doesNotMatch(guide, /if \(isFocused && !wasFocusedRef\.current\) startPreferenceAppliedRef\.current = false/);
  assert.doesNotMatch(guide, /const wasFocusedRef = useRef\(false\)/);
  assert.match(guide, /openFullscreenPlayer\(router, channel\.id, \{ returnToGuide: true, returnGuideGroup: group \}\)/);
});

// Keep this file in the validation PR path set so a head sync re-runs the no-APK gate.
