import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("transparent guide opens on the launch group and offers a playlist picker before groups", () => {
  const panel = read("src/components/PlayerGuidePanel.tsx");
  const player = read("app/player.tsx");
  assert.match(player, /initialGroup=\{String\(params\.returnGuideGroup \|\| ""\)\}/);
  // Launch group from the Guide, else the playing channel's own group; never stuck on All.
  assert.match(panel, /if \(launched && launched !== "All"\) return launched;/);
  assert.match(panel, /providerGroupKey\(playingChannel\.group\)/);
  assert.match(panel, /useState\(\(\) => \(playingChannel \? playlistOwner\(playingChannel\) : "all"\)\)/);
  assert.match(panel, /testID="player-guide-playlists"/);
  assert.match(panel, /testID="player-guide-groups"/);
  assert.ok(panel.indexOf('testID="player-guide-playlists"') < panel.indexOf('testID="player-guide-groups"'));
  // Choosing a playlist continues straight to that playlist's groups.
  assert.match(panel, /setPlaylistsOpen\(false\);\s*setGroupsOpen\(true\);/);
  assert.match(panel, /buildPlaylistMenu\(sources, channels/);
  // Group button is about three times its old width; picker lists can never collapse to zero.
  assert.match(panel, /groupAction: \{ width: 230/);
  assert.match(panel, /layerList: \{ flexGrow: 1, flexShrink: 1, minHeight: LIST_ROW_HEIGHT \* 3 \}/);
  assert.match(panel, /hasTVPreferredFocus=\{index === groupIndex\}/);
  assert.match(panel, /reloadGeneration=\{reloadGeneration\}/);
});

test("guide grids draw channel logos for nearby rows only, with bounded bitmaps", () => {
  const canvas = read("src/components/NativeGuideCanvas.tsx");
  const view = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const pkg = read("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt");
  // The big channel payload still carries only id/name/number.
  assert.match(canvas, /rows\[index\] = \{\s*id: channel\.id,\s*name: channel\.name,\s*number:/);
  assert.match(canvas, /visibleLogos=\{visibleLogos\}/);
  assert.match(canvas, /MAX_LOGO_ROWS = 160/);
  assert.match(pkg, /@ReactProp\(name = "visibleLogos"\)/);
  assert.match(view, /private const val MAX_LOGO_BITMAPS = 28/);
  assert.match(view, /releaseLogo\(eldest\.value\)/);
  assert.match(view.slice(view.indexOf("override fun onDetachedFromWindow")), /releaseAllLogos\(\)/);
  assert.match(read("app/(tabs)/guide.tsx"), /showLogos=\{channelLogos && !surfLogosSuppressed\}/);
  assert.match(read("src/components/PlayerGuidePanel.tsx"), /showLogos=\{showLogos\}/);
});

test("LEFT on a group in the Guide playlist panel jumps to its playlist header first", () => {
  const panel = read("src/components/PurpleGuideGroupDrawer.tsx");
  const left = panel.slice(panel.indexOf('if (key === "LEFT")'), panel.indexOf('if (key === "RIGHT")'));
  assert.match(left, /playlistHeaderFor\(focusedNameRef\.current, groupsRef\.current\)/);
  assert.ok(left.indexOf("requestNativeFocusWithRetry") < left.indexOf("openMainDrawerRef.current()"));
  assert.match(panel, /item\.kind === "playlist" && focusedName\.startsWith\(`\$\{item\.name\}:`\)/);
  assert.match(panel, /if \(!focused \|\| focused\.kind !== "group"\) return null;/);
});

test("a doubled select press cannot open and immediately close a Guide playlist", () => {
  const guide = read("app/(tabs)/guide.tsx");
  assert.match(guide, /const PLAYLIST_TOGGLE_DEBOUNCE_MS = 500;/);
  assert.match(guide, /if \(last && last\.id === id && now - last\.at < PLAYLIST_TOGGLE_DEBOUNCE_MS\) return;/);
  assert.match(guide, /togglePlaylistExpanded\(section\.id\)/);
});

test("OK on a channel name in either guide plays that channel", () => {
  const canvas = read("src/components/NativeGuideCanvas.tsx");
  const pressed = canvas.slice(canvas.indexOf("if (value.pressed)"), canvas.indexOf("}, [channelById, onChannelFocus"));
  assert.match(pressed, /else onChannelPress\(channel\);/);
  assert.match(read("app/(tabs)/guide.tsx"), /onChannelPress=\{play\}/);
  assert.match(read("src/components/PlayerGuidePanel.tsx"), /onChannelPress=\{tuneChannel\}/);
});
