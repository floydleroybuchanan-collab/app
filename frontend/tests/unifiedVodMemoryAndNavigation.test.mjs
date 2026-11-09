import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("native VOD lives in the same ReactActivity and uses only the shared rail/drawer", () => {
  const route = read("app/(tabs)/vod.tsx");
  const host = read("android/app/src/main/java/com/charmiptv/app/CharmEmbeddedVodView.kt");
  const manager = read("android/app/src/main/java/com/charmiptv/app/CharmVodViewManager.kt");
  const pkg = read("android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt");
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(route, /requireNativeComponent<NativeVodProps>\("CharmNativeVod"\)/);
  assert.match(route, /stopAllPlaybackSessions\("superseded"\)/);
  assert.match(route, /onRequestIconRail=\{openSharedRail\}/);
  assert.match(route, /onRequestMainDrawer=\{openMainDrawer\}/);
  assert.match(route, /suppressIconRail=\{playback\}/);
  assert.match(host, /NavHostFragment\.create\(VodR\.navigation\.nav_main_graph_tv\)/);
  assert.match(host, /event\("topRequestMainDrawer"\)/);
  assert.match(host, /event\("topRequestIconRail"\)/);
  assert.match(host, /OnBackPressedCallback/);
  assert.match(manager, /"CharmNativeVod"/);
  assert.match(pkg, /listOf\(CharmVodViewManager\(\)\)/);
  assert.match(shell, /suppressIconRail/);
  assert.doesNotMatch(route, /NativeModules\.CharmVod|startActivityForResult/);
  assert.doesNotMatch(host, /startActivity\(/);
});

test("VOD native fragments and listeners are released when leaving the route", () => {
  const host = read("android/app/src/main/java/com/charmiptv/app/CharmEmbeddedVodView.kt");
  const player = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/player/PlayerTvFragment.kt");
  assert.match(host, /override fun onDetachedFromWindow\(\)/);
  assert.match(host, /fun release\(\)/);
  assert.match(host, /backCallback\?\.remove\(\)/);
  assert.match(host, /removeOnGlobalFocusChangeListener\(focusListener\)/);
  assert.match(host, /removeOnDestinationChangedListener\(destinationListener\)/);
  assert.match(host, /remove\(oldHost\)\?\.commitNowAllowingStateLoss\(\)/);
  assert.match(host, /focusMemory = VodFocusMemory\(\)/);
  assert.match(player, /override fun onDestroyView\(\)/);
  assert.match(player, /releasePlayer\(\)/);
});

test("memory pressure must never wipe host guide and logo disk caches", () => {
  const cache = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/utils/CacheUtils.kt");
  const app = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/StreamFlixApp.kt");
  const bridge = read("android/app/src/main/java/com/charmiptv/app/CharmEmbeddedVodView.kt");
  const budget = read("android/app/src/main/java/com/charmiptv/app/CharmMemoryCoordinator.kt");
  assert.match(cache, /File\(base, "vod"\)/);
  assert.match(cache, /root\.listFiles\(\)\?\.forEach/);
  assert.match(cache, /AtomicBoolean\(false\)/);
  assert.match(cache, /fun pruneInBackground/);
  assert.match(cache, /Glide\.get\(context\.applicationContext\)\.trimMemory\(level\)/);
  assert.doesNotMatch(cache, /applicationContext\.cacheDir\?\.deleteRecursively|Glide\.get\(context\)\.clearDiskCache\(\)|WebView\(context\)/);
  assert.match(app, /CacheUtils\.trimMemory\(this, level\)/);
  assert.doesNotMatch(app, /level >= TRIM_MEMORY_RUNNING_LOW\)[\s\S]{0,120}CacheUtils\.clearAppCache\(this\)/);
  assert.match(bridge, /CacheUtils\.pruneInBackground/);
  assert.match(budget, /vodCacheBytes = minOf/);
});

test("one launcher remains, and Android update identity is not changed by VOD integration", () => {
  const hostManifest = read("android/app/src/main/AndroidManifest.xml");
  const embedded = read("android/vod/app/src/main/embedded/AndroidManifest.xml");
  const config = JSON.parse(read("app.json")).expo;
  const gradle = read("android/app/build.gradle");
  assert.match(hostManifest, /android:name="\.MainActivity"/);
  assert.doesNotMatch(embedded, /category\.LAUNCHER|category\.LEANBACK_LAUNCHER/);
  assert.equal(config.android.versionCode, 2500);
  assert.equal(config.android.package + ".sideload", "com.charmiptv.app.purple.next.vodtest1.sideload");
  assert.match(gradle, /versionCode 2500/);
});
