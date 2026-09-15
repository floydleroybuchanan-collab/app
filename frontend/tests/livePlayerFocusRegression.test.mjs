import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('drawer footer routing precedes the drawer-to-groups handoff for every opening path', async () => {
  const activity = await source('android/app/src/main/java/com/charmiptv/app/MainActivity.kt');
  const shell = await source('src/components/PurpleTvShell.tsx');
  assert.ok(activity.indexOf('if (routeShellBoundary(event))') < activity.indexOf('(context == "main_drawer" && boundaryKey == "RIGHT")'));
  assert.match(activity, /findTagged\(drawer, "purple-nav-pinned-footer"\)/);
  assert.match(activity, /TvFocusTraversal\.adjacent\(buttons, index, step\)/);
  assert.match(activity, /KEYCODE_DPAD_UP && testId\(focus\) == "purple-nav-live-tv"\) return true/);
  assert.match(shell, /testID="purple-main-drawer" collapsable=\{false\}/);
  assert.match(shell, /openDrawer\(\{ focusTop: true \}\)/);
});

test('player uses one visible focus owner and does not replay reveal as a click', async () => {
  const [player, activity, surface] = await Promise.all([
    source('app/player.tsx'), source('android/app/src/main/java/com/charmiptv/app/MainActivity.kt'),
    source('android/app/src/main/java/com/charmiptv/app/NativePlaybackSurface.kt'),
  ]);
  assert.match(player, /requestNativeFocusWithRetry/);
  assert.match(player, /testID="player-controls" collapsable=\{false\}/);
  assert.match(player, /onFocusCapture=\{\(\) => \{ controlsFocusedRef.current = true/);
  assert.match(player, /styles.touchCatcher\]\}[\s\S]{0,40}focusable=\{false\}/);
  assert.match(player, /overlayOpenRef.current \|\| keepControlsRef.current/);
  assert.match(activity, /PlayerSelectPolicy.activate\(pressedControl != null/);
  assert.match(activity, /if \(wasLong\) return true/);
  assert.match(surface, /descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS/);
});

test('Live TV and Guide begin with content while playlist selection remains in the drawer', async () => {
  const [home, guide] = await Promise.all([source('app/(tabs)/index.tsx'), source('app/(tabs)/guide.tsx')]);
  assert.doesNotMatch(home, /<MediaLabArt|<View style=\{styles.topbar\}/);
  assert.match(home, /<View style=\{styles.hero\}/);
  assert.doesNotMatch(guide, /accessibilityLabel="Choose playlists"/);
  assert.match(guide, /<GuidePreviewRail/);
  assert.match(guide, /<PurpleGuideGroupDrawer/);
  assert.match(guide, /label: "Guide Sources"/);
});
