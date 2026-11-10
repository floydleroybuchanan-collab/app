import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const v = "android/vod/app/src/main/java/com/streamflixreborn/streamflix/";

test("the unified Expo MainActivity never silently discards VOD poster clicks", () => {
  const ext = read(v + "utils/Extensions.kt");
  assert.match(ext, /fun FragmentActivity\.getCurrentFragment\(\)/);
  assert.match(ext, /else -> null/);
  const movies = read(v + "adapters/viewholders/MovieViewHolder.kt");
  const series = read(v + "adapters/viewholders/TvShowViewHolder.kt");
  const movieCard = movies.split("private fun displayTvItem(binding: ItemMovieTvBinding)")[1]?.split("private fun displayGridMobileItem(")[0] || "";
  const movieGrid = movies.split("private fun displayGridTvItem(binding: ItemMovieGridTvBinding)")[1]?.split("private fun ")[0] || "";
  for (const section of [movieCard, movieGrid]) {
    assert.ok(section.includes("if (BuildConfig.CHARM_VOD_EMBEDDED)"), "embedded movie route missing");
    assert.ok(section.includes('findNavController().navigate(R.id.movie, Bundle().apply'), "movie poster does not open details");
    assert.ok(section.includes('putString("id", movie.id)'));
  }
  const seriesCard = series.split("private fun displayTvItem(binding: ItemTvShowTvBinding)")[1]?.split("private fun displayGridMobileItem(")[0] || "";
  const seriesGrid = series.split("private fun displayGridTvItem(binding: ItemTvShowGridBinding)")[1]?.split("private fun ")[0] || "";
  for (const section of [seriesCard, seriesGrid]) {
    assert.ok(section.includes("if (BuildConfig.CHARM_VOD_EMBEDDED)"), "embedded TV show route missing");
    assert.ok(section.includes("findNavController().navigate(R.id.tv_show, tvShowArgs())"), "series poster does not open details");
  }
});

test("in-player Guide stays inside one decoder and gives remote-focusable two-pane channels plus EPG", () => {
  const player = read("app/player.tsx");
  assert.match(player, /const openQuickGuide = useCallback/);
  assert.match(player, /if \(action === "guide"\) return openQuickGuide\(\)/);
  assert.match(player, /<Pressable onPress=\{openQuickGuide\}/);
  assert.match(player, /<View style=\{styles.inPlayerGuide\}>/);
  assert.match(player, /<View style=\{styles.guideChannelsPane\}>/);
  assert.match(player, /<View style=\{styles.guideDetailsPane\}>/);
  assert.match(player, /const guidePreviewPrograms = useGuidePrograms/);
  assert.match(player, /initialNumToRender=\{10\}/);
  assert.match(player, /maxToRenderPerBatch=\{8\}/);
  assert.match(player, /if \(controlsFocusedRef\.current \|\| channelsOpenRef\.current \|\| tracksOpenRef\.current\) return/);
  assert.match(player, /onFocusCapture=\{\(\) =>/);
  assert.match(player, /onPress=\{goGuide\}/); // explicit Full Guide still accessible
  assert.doesNotMatch(player, /onPress=\{goGuide\}[^\n]*>Guide</);
});

test("DPAD channel browsing previews EPG without spinning up a decoder on focus", () => {
  const player = read("app/player.tsx");
  assert.match(player, /onFocus=\{\(\) => setGuidePreviewId\(item.id\)\}/);
  assert.match(player, /onPress=\{\(\) => \{ changeChannel\(item.id, true\); closeOverlayAndRestoreFocus\(\); \}\}/);
  assert.doesNotMatch(player, /previewChannel\(item.id\)/);
  assert.match(player, /const guidePreviewPrograms = useGuidePrograms/);
});
