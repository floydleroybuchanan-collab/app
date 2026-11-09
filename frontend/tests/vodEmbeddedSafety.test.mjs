import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const vod = "android/vod/app/src/main/java/com/streamflixreborn/streamflix/";

test("embedded VOD uses a scoped Leanback inflater with safe host attributes", () => {
  const styles = read("android/app/src/main/res/values/styles.xml");
  const root = read(vod + "charm/VodRootFragment.kt");
  for (const name of [
    "app_background_color", "home_gradient_drawable", "movie_banner_gradient_drawable",
    "tv_show_banner_gradient_drawable", "category_swiper_gradient_drawable", "preferenceTheme"
  ]) assert.match(styles, new RegExp(`name="${name}"`));
  assert.match(root, /ContextThemeWrapper/);
  assert.match(root, /ThemeManager\.tvThemeRes\(UserPreferences\.selectedTheme\)/);
  assert.match(root, /cloneInContext\(themedContext\)/);
  assert.doesNotMatch(root, /requireActivity\(\)\.setTheme\(/);
});

test("mount failures retain complete native stack and deepest causes", () => {
  const manager = read("android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt");
  assert.match(manager, /Log\.e\(TAG, "Embedded VOD failed to inflate\/mount", e\)/);
  assert.match(manager, /generateSequence\(error\) \{ it\.cause \}/);
  assert.match(manager, /emit\("CharmVodMountError", failureSummary\(e\)\)/);
  assert.match(manager, /host\.detachVodInput\(this\)/);
});

test("embedded playback leaves MainActivity orientation unchanged and shares provider cookies", () => {
  const player = read(vod + "fragments/player/PlayerTvFragment.kt");
  assert.match(player, /if \(!BuildConfig\.CHARM_VOD_EMBEDDED\) \{/);
  assert.match(player, /hostBarsBeforePlayback/);
  assert.match(player, /bars\.show\(WindowInsetsCompat\.Type\.statusBars\(\)\)/);
  assert.match(player, /\.cookieJar\(NetworkClient\.cookieJar\)/);
  assert.match(player, /releasePlayer\(\)/);
});

test("VOD cache invalidation is scoped to VOD paths and its in-memory catalog", () => {
  const cache = read(vod + "utils/CacheUtils.kt");
  const home = read(vod + "utils/HomeCacheStore.kt");
  const app = read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt");
  assert.match(cache, /HomeCacheStore\.clearMemory\(\)/);
  assert.match(cache, /File\(app\.cacheDir, "vod"\)/);
  assert.match(cache, /File\(app\.filesDir, "home-cache"\)/);
  assert.doesNotMatch(cache.replace(/\/\/[^\n]*/g, ""), /context\.cacheDir\.deleteRecursively\(\)/);
  assert.match(home, /MAX_MEMORY_PROVIDERS = 2/);
  assert.match(home, /MAX_MEMORY_ITEMS = 3000/);
  assert.match(home, /synchronized\(memoryCache\)/);
  assert.match(home, /fun clearMemory\(\)/);
  assert.match(app, /HomeCacheStore\.clearMemory\(\)/);
});

test("network-series metadata never masquerades as verified platform originals", () => {
  const platform = read(vod + "charm/VodPlatformsFragment.kt");
  const originals = read(vod + "charm/VodPlatformCatalog.kt");
  assert.match(platform, /loadNetworkSeries\(allowed\)/);
  assert.match(platform, /provider is TmdbProvider/);
  assert.match(platform, /VodPlatformCatalog\.find\(local\) == null/);
  assert.match(platform, /Network series/);
  assert.match(originals, /Original\/exclusive attribution/);
});

test("native Back and D-pad navigation remain integrated with host drawer and VOD detail stack", () => {
  const root = read(vod + "charm/VodRootFragment.kt");
  const focus = read(vod + "charm/VodFocusCoordinator.kt");
  assert.match(root, /player\?\.onBackPressed\(\) == true/);
  assert.match(root, /controller\.navigateUp\(\)/);
  assert.match(root, /onHostBack\?\.invoke\(\)/);
  assert.match(focus, /KEYCODE_DPAD_UP/);
  assert.match(focus, /KEYCODE_DPAD_DOWN/);
  assert.match(focus, /KEYCODE_DPAD_LEFT/);
  assert.match(focus, /KEYCODE_DPAD_RIGHT/);
});
