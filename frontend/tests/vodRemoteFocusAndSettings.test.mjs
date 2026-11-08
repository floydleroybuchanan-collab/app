import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = p => readFileSync(resolve(root, p), "utf8");
const vod = p => source("android/vod/app/src/main/java/com/streamflixreborn/streamflix/" + p);
test("movie and series open and return from Stop at Watch, never a rail item", () => {
  for (const [path, id] of [
    ["fragments/movie/MovieTvFragment.kt","btn_movie_watch_now"],
    ["fragments/tv_show/TvShowTvFragment.kt","btn_tv_show_watch_now"],
  ]) {
    const s = vod(path);
    assert.match(s, /private fun focusWatchAction\(\)/);
    assert.match(s, new RegExp("R\\.id\\." + id));
    assert.match(s, /override fun onResume\(\) \{[\s\S]*?focusWatchAction\(\)/);
    assert.match(s, /appAdapter\.submitList\([\s\S]*?focusWatchAction\(\)/);
  }
  const memory = vod("charm/VodFocusMemory.kt");
  assert.match(memory, /preferredActionId = when \(f\)/);
  assert.match(memory, /target != null && target\.requestFocus\(\)/);
});
test("embedded VOD drawer requires explicit Options, never an accidental right-edge DPAD", () => {
  const drawer = vod("charm/CharmPageDrawer.kt");
  assert.match(drawer, /if \(CharmHostSession\.hasSurface\(activity\)\) return false/);
  assert.match(drawer, /validOrigin\?\.requestFocus\(\) == true/);
  assert.match(drawer, /R\.id\.btn_movie_watch_now/);
  assert.match(drawer, /R\.id\.btn_tv_show_watch_now/);
});
test("VOD content retains remote focus, artwork is decorative", () => {
  const native = source("android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt");
  const shell = source("src/components/PurpleTvShell.tsx");
  const art = source("src/components/MediaLabBrand.tsx");
  assert.match(native, /retainDetailFocusOnLeft\(\)/);
  assert.match(native, /VodR\.id\.movie, VodR\.id\.tv_show/);
  assert.match(shell, /active !== "\/vod"/);
  assert.match(art, /accessible=\{false\} importantForAccessibility="no"/);
});
test("VOD settings begin below Back and back control is compact", () => {
  const page = source("src/components/MediaLabVodContent.tsx");
  const layout = vod("fragments/settings/CharmSettingsLayout.kt");
  const fragment = vod("fragments/settings/SettingsTvFragment.kt");
  assert.match(page, /settings && styles\.settingsBackButton/);
  assert.match(page, /width: 186, maxWidth: 186/);
  assert.match(layout, /if \(embedded\) dp\(8\) else CharmVodPageLayout\.contentTop\(root\)/);
  assert.match(layout, /val leftInset = dp\(if \(embedded\) 76 else 24\)/);
  assert.match(fragment, /focusFirstSettingsControl\(\)/);
  assert.doesNotMatch(fragment, /listView\?\.requestFocus\(\)/);
});
