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

test("unified VOD opens native route immediately without a startup loading overlay", () => {
  const route = read("app/(tabs)/vod.tsx");
  const manager = read("android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt");
  const root = read(vod + "charm/VodRootFragment.kt");
  assert.match(route, /<NativeVod/);
  assert.match(route, /CharmVodRootReady/);
  assert.match(route, /void stopAllPlaybackSessions\("superseded"\)/);
  assert.doesNotMatch(route, /<ActivityIndicator/);
  assert.doesNotMatch(route, /waitingLong/);
  assert.match(manager, /fun retryHost\(/);
  assert.match(manager, /fun restoreNativeFocus\(/);
  assert.match(manager, /emit\("CharmVodRootReady", elapsedMs\.toString\(\)\)/);
  assert.match(root, /fun restoreFocusFromRail\(\)/);
});

test("VOD native focus leaves RN guide traps and crosses both rail boundaries", () => {
  const shell = read("src/components/PurpleTvShell.tsx");
  const activity = read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
  const coordinator = read(vod + "charm/VodFocusCoordinator.kt");
  assert.match(shell, /active !== "\/vod" && !immersiveContent/);
  assert.match(shell, /focusIconRail\(\)/);
  assert.match(activity, /vod\.restoreNativeFocus\(\)/);
  assert.match(activity, /fun focusVodRailFromContent\(\)/);
  assert.match(coordinator, /fun restoreFocusFromHost\(\)/);
  assert.match(coordinator, /binding\.navMainFragment\.requestLayout\(\)/);
  assert.doesNotMatch(coordinator, /binding\.navMain(?!Fragment)/);
});


test("Platforms always opens instantly with accessible choices and bounded discovery", () => {
  const fragment = read(vod + "charm/VodPlatformsFragment.kt");
  const nav = read(vod + "charm/VodGlassActionBar.kt");
  assert.match(nav, /Action\(R\.id\.platforms, "Platforms"/);
  assert.match(fragment, /addPlatformShortcuts\(column\)/);
  assert.match(fragment, /findNavController\(\)\.navigate\(R\.id\.platform_titles/);
  assert.match(fragment, /withTimeoutOrNull\(12_000L\)/);
  assert.match(fragment, /withTimeoutOrNull\(15_000L\)/);
  assert.match(fragment, /Catalog lookup took too long or failed/);
});

test("platform View All buttons have platform-specific neon glass styling", () => {
  const badges = read(vod + "charm/VodPlatformBadgeView.kt");
  const platforms = read(vod + "charm/VodPlatformsFragment.kt");
  for (const id of ["netflix", "disney", "apple", "hulu", "max", "prime", "paramount", "peacock"]) {
    assert.match(badges, new RegExp('"' + id + '" ->'));
  }
  assert.match(badges, /fun viewAllGlass\(focused: Boolean\)/);
  assert.match(platforms, /badge\.viewAllGlass\(focused\)/);
});

test("Platforms only exposes the ten approved services", () => {
  const catalog = read(vod + "charm/VodPlatformCatalog.kt");
  const listed = [...catalog.matchAll(/Platform\("([^"]+)",/g)].map((match) => match[1]);
  assert.deepEqual(listed, [
    "netflix", "disney", "apple", "hulu", "max", "prime",
    "paramount", "peacock", "starz", "amc"
  ]);
});

test("approved dashboard has persistent hero, ten matching platform actions and movie shelves", () => {
  const homeXml = read("android/vod/app/src/main/res/layout/fragment_home_tv.xml");
  const dashboard = read(vod + "fragments/home/CharmingVodDashboardView.kt");
  const fragment = read(vod + "fragments/home/HomeTvFragment.kt");
  const top = read(vod + "charm/VodGlassActionBar.kt");
  assert.match(homeXml, /charming_vod_dashboard/);
  assert.match(homeXml, /layout_constraintTop_toBottomOf="@id\/charming_vod_dashboard"/);
  assert.match(dashboard, /"▶  Watch Now"/);
  assert.match(dashboard, /"＋  My List"/);
  assert.match(dashboard, /VodPlatformCatalog\.platforms\.forEach/);
  assert.match(dashboard, /badge\.viewAllGlass\(focused\)/);
  assert.match(dashboard, /contentDescription = "Open \$\{platform\.label\}"/);
  assert.match(dashboard, /setOnClickListener \{ onPlatform\?\.invoke\(platform\.id\) \}/);
  assert.match(dashboard, /TRENDING MOVIES/);
  assert.match(fragment, /binding\.charmingVodDashboard\.bindFeatured\(chosen\)/);
  assert.match(fragment, /findNavController\(\)\.navigate\(R\.id\.platform_titles/);
  assert.match(top, /isFillViewport = true/);
  assert.match(top, /LayoutParams\(0, dp\(110\), 1f\)/);
});

test("unified VOD never covers native home with the old catalog loading screen", () => {
  const homeXml = read("android/vod/app/src/main/res/layout/fragment_home_tv.xml");
  const fragment = read(vod + "fragments/home/HomeTvFragment.kt");
  const root = read(vod + "charm/VodRootFragment.kt");
  assert.match(homeXml, /android:id="@\+id\/is_loading"/);
  assert.match(homeXml, /android:visibility="gone"/);
  assert.match(fragment, /HomeViewModel\.State\.Loading -> \{/);
  assert.match(fragment, /binding\.isLoading\.root\.visibility = View\.GONE/);
  assert.match(fragment, /dashboard\.reportCatalogError\(\)/);
  assert.doesNotMatch(fragment, /pbIsLoading\.visibility = View\.VISIBLE/);
  const embedded = read("android/vod/app/src/main/res/layout/activity_main_tv.xml");
  assert.doesNotMatch(embedded, /VodIconRail|CharmVodWelcomeView|android:id="@\+id\/nav_main"/);
  assert.doesNotMatch(root, /navMain|ivSplashOverlay/);
});
