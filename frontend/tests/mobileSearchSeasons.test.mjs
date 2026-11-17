import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const vod = "android/vod/app/src/main/java/com/streamflixreborn/streamflix";
const app = "android/app/src/main/java/com/charmiptv/app";

test("Device layout is decided natively before the first screen and Mobile is real", async () => {
  const [runtime, store, device, pkg] = await Promise.all([
    source("src/utils/tvRuntime.ts"), source("src/store.tsx"),
    source(`${app}/CharmDeviceModule.kt`), source(`${app}/CharmVodPackage.kt`),
  ]);
  assert.match(runtime, /if \(mode === "tv"\) return true;\s+if \(mode === "mobile"\) return false;/);
  assert.match(runtime, /return !!info\.leanback \|\| !info\.touch \|\| !!info\.keyboard;/);
  assert.match(runtime, /get: \(\) => actsAsTv/);
  assert.match(runtime, /export function applyDeviceLayoutChoice/);
  assert.match(runtime, /export function currentDeviceLayoutMode\(\): DeviceLayoutChoice/);
  // theme.ts's `phoneUi` constant freezes on this same native read at process start. The reactive
  // `deviceLayoutMode` in the store must start from that exact value, not a separately stored JS
  // copy that could disagree with it and leave the shell and the screens picking different layouts.
  assert.match(store, /useState<DeviceLayoutMode>\(\(\) => currentDeviceLayoutMode\(\)\)/);
  // A stored JS value is mirrored for display, never re-applied over the native decision.
  assert.doesNotMatch(store, /if \(!settingsTouchedRef\.current\.has\(DEVICE_LAYOUT_MODE_KEY\)\) \{\s*applyDeviceLayoutChoice/);
  assert.equal((store.match(/applyDeviceLayoutChoice\(/g) || []).length, 1);
  assert.match(device, /isBlockingSynchronousMethod = true\)\s+fun profileSync/);
  assert.match(device, /FEATURE_TOUCHSCREEN/);
  assert.match(pkg, /CharmDeviceModule\(context\)/);
});

test("TV Guide grid works by touch: tap opens the cell, drag scrolls", async () => {
  const guide = await source(`${app}/NativeGuideView.kt`);
  assert.match(guide, /override fun onTouchEvent\(event: MotionEvent\): Boolean/);
  assert.match(guide, /private fun tapAt\(x: Float, y: Float\)/);
  assert.match(guide, /emitSelection\(true, pressed = true\)\s+}\s+private fun moveVertical/);
  assert.match(guide, /private fun scrollRowsByTouch/);
  assert.match(guide, /private fun scrollTimeByTouch/);
  assert.match(guide, /requestDisallowInterceptTouchEvent\(true\)/);
});

test("VOD search shows poster results while typing and has no genre tiles", async () => {
  const [fragment, model, recents, layout] = await Promise.all([
    source(`${vod}/fragments/search/SearchTvFragment.kt`), source(`${vod}/fragments/search/SearchViewModel.kt`),
    source(`${vod}/charm/VodSearchRecents.kt`), source("android/vod/app/src/main/res/layout/fragment_search_tv.xml"),
  ]);
  assert.doesNotMatch(fragment, /Genre/);
  assert.match(fragment, /SearchViewModel\(database, browseWhenEmpty = false\)/);
  assert.match(fragment, /const val LIVE_MIN_LETTERS = 2/);
  assert.match(fragment, /postDelayed\(liveSearch/);
  assert.match(fragment, /removeCallbacks\(liveSearch\)/);
  assert.match(fragment, /else -> it is Movie \|\| it is TvShow/);
  // Large result lists: a wrapping six-wide grid with an All / Movies / Series choice.
  assert.match(fragment, /currentGridColumns = 6/);
  assert.match(fragment, /listOf\("All \(\$\{movies \+ series\}\)", "Movies \(\$movies\)", "Series \(\$series\)"\)/);
  assert.match(recents, /fun filters\(row: LinearLayout, labels: List<String>, selected: Int/);
  assert.match(layout, /@\+id\/ll_search_filter/);
  // Only the newest search may publish, and an empty box asks the provider nothing.
  assert.match(model, /searching\?\.cancel\(\)/);
  assert.match(model, /if \(query\.isBlank\(\) && !browseWhenEmpty\)/);
  assert.match(model, /title\.startsWith\(typed\) -> 0/);
  assert.match(recents, /private const val MAX = 6/);
  assert.match(layout, /@\+id\/ll_search_recents/);
});

test("Series page: Seasons list on the left opens its episodes on the right, both scroll in their box", async () => {
  const [panels, fragment] = await Promise.all([
    source(`${vod}/charm/VodTitlePanels.kt`), source(`${vod}/fragments/tv_show/TvShowTvFragment.kt`),
  ]);
  assert.match(panels, /private const val VISIBLE_ROWS = 8/);
  assert.match(panels, /RecyclerView\.Adapter<LineHolder>/);
  assert.match(panels, /"Seasons \(\$\{seasons\.size\}\)"/);
  assert.match(panels, /preview = Runnable \{ open\(index, false\) \}/);
  assert.match(panels, /open\(index, true\)/);
  assert.match(panels, /private const val KEPT_SEASONS = 3/);
  // The whole season is listed, not the first five.
  assert.doesNotMatch(panels, /episodes\.take\(5\)/);
  // The season poster row (and with it the big episode pages) is gone from the title page.
  assert.doesNotMatch(fragment, /TV_SHOW_SEASONS_TV/);
});
