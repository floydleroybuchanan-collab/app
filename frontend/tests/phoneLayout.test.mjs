import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the app uses the whole display in landscape (cutout side) and never shows a light gap", () => {
  const styles = read("android/app/src/main/res/values/styles.xml");
  assert.match(styles, /windowLayoutInDisplayCutoutMode"[^>]*>shortEdges</);
  assert.match(styles, /windowBackground">@color\/charm_window_background</);
  assert.match(read("android/app/src/main/res/values/colors.xml"), /charm_window_background">#070711</);
});

test("a phone gets a bottom bar held upright, keeps the cutout clear, and the TV rail rules stay as they were", () => {
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(shell, /const phone = !shouldUseTvLayout\(deviceLayoutMode\)/);
  assert.match(shell, /const bottomBar = phone && height > width && !immersiveContent/);
  assert.match(shell, /const railAllowed = phone \? !bottomBar : railPreferences\.ready && railPreferences\.enabled && !railTimedOut/);
  assert.match(shell, /insets\.left/);
  assert.match(shell, /<PhoneBottomBar /);
  assert.match(shell, /openDrawer\(\{ force: true \}\)/);
  // The bar, the More sheet and the crown backdrop are for touch only.
  assert.match(shell, /<PhoneBackdrop \/>/);
  assert.match(shell, /\{phone && isFocused && \(drawerOpen \|\| drawerVisible\) \?/);
  const chrome = read("src/components/PhoneChrome.tsx");
  assert.match(chrome, /testID="purple-phone-bar"/);
  assert.match(chrome, /testID="purple-drawer-scrim"/);
  // Five tabs as designed: Live TV, Guide, Channels, On Demand, More.
  for (const label of ["Live TV", "Guide", "Channels", "On Demand"]) assert.match(chrome, new RegExp(`label: "${label}"`));
  assert.match(chrome, /accessibilityLabel="More"/);
  // The More sheet holds the nine places from the design, Exit last.
  for (const label of ["Favorites", "My Reminders", "Search", "Movies", "Series", "Playlists", "Settings", "Account", "Exit"]) assert.match(chrome, new RegExp(`label: "${label}"`));
  // The crown is never rotated: it is centred and only scaled.
  assert.doesNotMatch(chrome, /rotate:|rotate\(/);
});

test("the root layout follows the real window on a phone and keeps the TV sizing", () => {
  const layout = read("app/_layout.tsx");
  assert.match(layout, /isTV \? \{ flex: 1, width, height, overflow: "visible"/);
  assert.match(layout, /: \{ flex: 1, backgroundColor: "#070711" \}/);
});

test("the loading cover is solid from the first frame: only the picture fades in", () => {
  const startup = read("src/components/StartupVersion4.tsx");
  assert.match(startup, /const fadeIn = useRef\(new Animated\.Value\(0\)\)/);
  assert.match(startup, /const fade = useRef\(new Animated\.Value\(1\)\)/);
  assert.match(startup, /opacity: fadeIn/);
  const scene = read("src/components/StartupScene.tsx");
  // Upright phone: fit the width instead of cutting the crown off at both sides.
  assert.match(scene, /const portrait = height > width \* 1\.05/);
  assert.match(scene, /portrait \? width \/ 760/);
});

test("the account check shows the new launcher picture on black, not the old circle logo", () => {
  const gate = read("src/components/AccountGate.tsx");
  assert.doesNotMatch(gate, /MediaLabArt/);
  assert.match(gate, /account-session-restoring[\s\S]{0,400}medialab_launcher\.png/);
});

test("the video view is re-laid out after a turn so portrait video is not stretched", () => {
  const surface = read("android/app/src/main/java/com/charmiptv/app/NativePlaybackSurface.kt");
  assert.match(surface, /override fun requestLayout\(\)/);
  assert.match(surface, /private fun fitChildren\(w: Int, h: Int\)/);
  assert.match(surface, /fitChildren\(w, h\)/);
});

test("VOD home folds its hero away on touch phones only and scales to the width held upright", () => {
  const fragment = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/home/HomeTvFragment.kt");
  assert.match(fragment, /if \(isTouchPhone\(\)\) foldDashboardWhileScrolling\(\)/);
  assert.match(fragment, /UI_MODE_TYPE_TELEVISION/);
  assert.match(fragment, /FEATURE_LEANBACK/);
  const dashboard = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/home/CharmingVodDashboardView.kt");
  assert.match(dashboard, /m\.heightPixels > m\.widthPixels \* 1\.1f/);
  assert.match(dashboard, /coerceIn\(0\.8f, 1\.5f\)/);
});
