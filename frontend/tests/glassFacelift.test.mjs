import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("icon rail and drawer use the colorful glass icons, a gear for Settings and the crown", () => {
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(shell, /route: "\/settings", label: "Settings", art: require\("..\/..\/assets\/glass\/settings_gear.png"\)/);
  assert.match(shell, /source=\{RAIL_CROWN\}/);
  assert.match(shell, /<NavArt source=\{item.art\} size=\{20\} \/>/);
  assert.match(shell, /<NavArt source=\{item.art\} size=\{21\} \/>/);
  // The drawer has no logo at all any more, and decorations are never remote stops.
  assert.doesNotMatch(shell, /SmallBrand|kind="wordmark"|kind="rail"/);
  assert.match(shell, /function NavArt[\s\S]*?<Image accessible=\{false\}/);
  assert.ok(statSync(new URL("../assets/glass/settings_gear.png", import.meta.url)).size < 64 * 1024);
  assert.ok(statSync(new URL("../assets/medialab/medialab_crown.png", import.meta.url)).size < 64 * 1024);
});

test("Guide puts the live preview at the very top with nothing above it", () => {
  const guide = read("app/(tabs)/guide.tsx");
  assert.doesNotMatch(guide, /Choose playlists/);
  // The playlist panel is still one LEFT press away from the grid.
  assert.match(guide, /onGuideLeftBoundary = useCallback\(\(\) => \{\s*if \(!drawerOpen && !groupDrawerOpen && !activeProgram\) setGroupDrawerOpen\(true\)/);
  const page = guide.slice(guide.indexOf('<View style={styles.page}>'));
  assert.ok(page.indexOf("<EpgProgressBar />") < page.indexOf("<GuideSelectionPreview"));
});

test("pages share the Settings glass focus and a text title instead of large artwork", () => {
  const theme = read("src/theme.ts");
  assert.match(theme, /export const glassFocus = \{/);
  for (const path of ["app/(tabs)/index.tsx", "app/(tabs)/channels.tsx", "app/(tabs)/favorites.tsx", "app/(tabs)/search.tsx", "app/(tabs)/reminders.tsx", "src/components/PurpleChannelCollection.tsx"]) {
    assert.match(read(path), /<GlassPageTitle page=/, path);
  }
  assert.doesNotMatch(read("app/(tabs)/index.tsx"), /MediaLabArt/);
  const title = read("src/components/GlassPageTitle.tsx");
  assert.match(title, /pointerEvents="none" accessible=\{false\}/);
});

test("native Guide paints rounded glass cells without allocating per cell", () => {
  const view = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /private val cellRect = RectF\(\)/);
  assert.match(view, /canvas.drawRoundRect\(cellRect, cellRadius, cellRadius, fill\)/);
  assert.doesNotMatch(view.slice(view.indexOf("override fun onDraw")), /RectF\(/);
});
