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
  assert.match(manager, /val message = failureSummary\(e\)/);
  assert.match(manager, /emit\("CharmVodMountError", message\)/);
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
  assert.match(home, /MAX_MEMORY_ITEMS = 1500/);
  assert.match(home, /synchronized\(memoryCache\)/);
  assert.match(home, /fun clearMemory\(\)/);
  assert.match(app, /HomeCacheStore\.clearMemory\(\)/);
});

test("network-series metadata never masquerades as verified platform originals", () => {
  const platform = read(vod + "charm/VodPlatformsFragment.kt");
  const originals = read(vod + "charm/VodPlatformCatalog.kt");
  assert.match(platform, /discoverPlatformTitles\(platforms, language, pages\)/);
  assert.match(platform, /provider as\? TmdbProvider/);
  assert.match(platform, /VodPlatformCatalog\.find\(it\) == null/);
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
    "netflix", "prime", "disney", "max", "hulu", "apple", "paramount", "peacock",
    "starz", "amc", "youtube", "crunchyroll"
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
  assert.match(dashboard, /VodPlatformBadgeView\(context, platform, small = false, pill = true\)/);
  assert.match(dashboard, /contentDescription = "Open \$\{platform\.label\}"/);
  assert.match(dashboard, /setOnClickListener \{ onPlatform\?\.invoke\(platform\.id\) \}/);
  assert.match(fragment, /"Trending Movies"/);
  assert.match(fragment, /binding\.charmingVodDashboard\.bindFeatured\(chosen\)/);
  assert.match(fragment, /findNavController\(\)\.navigate\(R\.id\.platform_titles/);
  assert.match(top, /isFillViewport = true/);
  assert.match(top, /LayoutParams\(0, dp\(49\), 1f\)/);
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
  assert.doesNotMatch(root, /\bnavMain\b|ivSplashOverlay/);
});

test("VOD first paint is offline, cache-first and never waits for Room or provider picker", () => {
  const graph = read("android/vod/app/src/main/res/navigation/nav_main_graph_tv.xml");
  const root = read(vod + "charm/VodRootFragment.kt");
  const home = read(vod + "fragments/home/HomeTvFragment.kt");
  const model = read(vod + "fragments/home/HomeViewModel.kt");
  const cache = read(vod + "utils/HomeCacheStore.kt");
  const cleaner = read(vod + "utils/CacheUtils.kt");
  assert.match(graph, /app:startDestination="@id\/home"/);
  assert.doesNotMatch(root, /UserPreferences\.currentProvider != null -> controller\.navigate\(R\.id\.home\)/);
  assert.match(root, /notifyWhenDrawn\(\)/);
  assert.match(model, /val immediateState: StateFlow<State> = _state\.asStateFlow\(\)/);
  assert.match(model, /refreshJob\?\.isActive == true/);
  assert.match(home, /viewModel\.immediateState/);
  assert.doesNotMatch(home, /ProviderChangeNotifier\.providerChangeFlow/);
  assert.doesNotMatch(home, /CacheUtils\.clearAppCache/);
  assert.match(cache, /AtomicFile\(target\)/);
  const startupCleaner = cleaner.split("fun autoClearIfNeeded(")[1];
  assert.ok(startupCleaner);
  assert.doesNotMatch(startupCleaner, /clearAppCache\(/);
});

test("VOD warms the retained hero and first posters without blocking app startup", () => {
  const warmer = read(vod + "charm/VodHomePrewarm.kt");
  const app = read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt");
  const bridge = read("android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt");
  assert.match(warmer, /HomeCacheStore\.read/);
  assert.match(warmer, /Dispatchers\.IO/);
  assert.match(warmer, /DiskCacheStrategy\.DATA/);
  assert.match(warmer, /\.take\(10\)/);
  assert.match(warmer, /\.filter \{ it\.name != Category\.FEATURED \}/);
  assert.match(warmer, /warmJob\?\.cancel\(\)/);
  assert.match(warmer, /REWARM_AFTER_MS = 15L/);
  assert.match(warmer, /Priority\.HIGH/);
  assert.match(app, /VodHomePrewarm\.onAppStart\(this\)/);
  assert.match(bridge, /showFailure\(message\)/);
});

test("VOD catalog and user caches are bounded without discarding watch history", () => {
  const home = read(vod + "utils/HomeCacheStore.kt");
  const user = read(vod + "utils/UserDataCache.kt");
  const model = read(vod + "fragments/home/HomeViewModel.kt");
  assert.match(home, /MAX_DISK_PROVIDERS = 3/);
  assert.match(home, /MAX_DISK_BYTES = 24L \* 1024L \* 1024L/);
  assert.match(home, /pruneOldCatalogs\(context, target\)/);
  assert.match(home, /gson\.toJson\(payload, writer\)/);
  assert.doesNotMatch(home, /gson\.toJson\(payload\)\.toByteArray/);
  assert.match(user, /Collections\.synchronizedMap/);
  assert.match(user, /size > 2/);
  assert.match(user, /fun clearMemory\(\)/);
  const app = read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt");
  assert.match(app, /UserDataCache\.clearMemory\(\)/);
  assert.match(model, /boundedLookupCache<TvShow>\(24\)/);
  assert.match(model, /boundedLookupCache<List<Episode>>\(32\)/);
  assert.doesNotMatch(model, /loadUserDataCache\(initialProvider\)/);
  assert.match(model, /viewModelScope\.launch\(Dispatchers\.IO\)/);
  // Do not evict the real user's saved favorites or watch history on a cache trim.
  assert.doesNotMatch(home.split("private fun pruneOldCatalogs(")[1].split("private fun cacheFile(")[0], /user-data-cache|clearAll\(/);
});

test("unified VOD artwork preserves host Glide and verifies TLS certificates", () => {
  const glide = read(vod + "ui/GlideCustomModule.kt");
  const loader = read(vod + "ui/AnimeOnlineNinjaCronetUrlLoader.kt");
  assert.match(glide, /registry\.prepend\(GlideUrl::class\.java, InputStream::class\.java, loader\)/);
  assert.match(glide, /onlySpecialVodImages = !isSeparateVodProcess/);
  assert.match(loader, /private val onlySpecialVodImages: Boolean = false/);
  assert.match(loader, /isAnimeOnlineNinja\(model\)/);
  assert.match(loader, /it\.startsWith\("sf_headers="\)/);
  assert.doesNotMatch(glide, /hostnameVerifier|sslSocketFactory|trustAllCerts/);
  assert.match(glide, /10 \* 1024 \* 1024/);
});

test("Android TV startup never wipes an in-use VOD artwork HTTP cache", () => {
  const startup = read(vod + "StreamFlixApp.kt");
  const cleaner = read(vod + "utils/CacheUtils.kt");
  assert.doesNotMatch(startup, /CacheUtils\.autoClearIfNeeded/);
  const auto = cleaner.split("fun autoClearIfNeeded(")[1];
  assert.ok(auto);
  assert.doesNotMatch(auto, /deleteRecursively\(\)/);
  assert.match(auto, /glide-okhttp-cache/);
  assert.match(auto, /bounded OkHttp artwork cache/);
});
