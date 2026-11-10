import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (s) => readFileSync(new URL("../" + s, import.meta.url), "utf8");
const native = "android/vod/app/src/main/";
const charm = native + "java/com/streamflixreborn/streamflix/charm/";
const holder = native + "java/com/streamflixreborn/streamflix/adapters/viewholders/";
const xml = native + "res/layout/";

test("VOD Home and Platforms visual sources remain untouched by this repair", () => {
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(shell, /showIconRail/);
  assert.match(shell, /drawerRendered/);
  const root = read(charm + "VodRootFragment.kt");
  assert.match(root, /onGetLayoutInflater\(savedInstanceState/);
  assert.match(root, /ThemeManager\.tvThemeRes\(UserPreferences\.selectedTheme\)/);
});

test("Genres are virtualized, provider ID-safe, with at most 120 items and original vector icons", () => {
  const hub = read(charm + "VodGenresHubFragment.kt");
  const icon = read(charm + "CharmingVodGenreIcon.kt");
  assert.match(hub, /GridLayoutManager\(context, 3\)/);
  assert.match(hub, /RecyclerView\.Adapter<GenreCardHolder>/);
  assert.match(hub, /take\(120\)/);
  assert.match(hub, /putString\("id", genre\.id\)/);
  assert.match(hub, /putString\("name", genre\.name\)/);
  assert.match(hub, /override fun onDestroyView\(\)/);
  assert.match(hub, /grid\?\.adapter = null/);
  assert.doesNotMatch(hub, /ScrollView/);
  assert.match(icon, /class CharmingVodGenreIcon.*Drawable\(\)/s);
  assert.doesNotMatch(icon, /BitmapFactory|BitmapDrawable|Glide\.with|FileInputStream/);
});

test("nested Settings use transparent original icons without flattening their gradients", () => {
  const fragment = read(native + "java/com/streamflixreborn/streamflix/fragments/settings/SettingsTvFragment.kt");
  const styler = read(native + "java/com/streamflixreborn/streamflix/fragments/settings/SettingsListStyler.kt");
  const artwork = read(charm + "CharmingVodSettingsIcon.kt");
  assert.match(fragment, /private fun stylePreferenceIcons\(group: PreferenceGroup\)/);
  assert.match(fragment, /preferenceScreen\?\.let\(::stylePreferenceIcons\)/);
  assert.match(styler, /if \(it is CharmingVodSettingsIcon\) null/);
  assert.match(styler, /styleSwitches\(view, accentColor\)/);
  assert.match(artwork, /class CharmingVodSettingsIcon.*Drawable\(\)/s);
  assert.doesNotMatch(artwork, /BitmapFactory|BitmapDrawable|Glide\.with|FileInputStream/);
});

test("movie and series detail Sources/My List are real focusable actions mapped to existing owners", () => {
  const preference = read(native + "java/com/streamflixreborn/streamflix/vod/VodPreferences.kt");
  assert.match(preference, /AtomicLong\(0L\)/);
  assert.match(preference, /fun requestSourcesForNextPlayback\(\)/);
  assert.match(preference, /sourcePickerRequestedAt\.getAndSet\(0L\)/);
  const player = read(native + "java/com/streamflixreborn/streamflix/fragments/player/PlayerTvFragment.kt");
  assert.match(player, /VodPreferences\.chooseFirst \|\| state\.servers\.isEmpty\(\)/);
  for (const kind of ["movie", "tv_show"]) {
    const layout = read(xml + "content_" + kind + "_tv.xml");
    const action = kind === "movie" ? "Movie" : "TvShow";
    const viewholder = read(holder + (kind === "movie" ? "MovieViewHolder.kt" : "TvShowViewHolder.kt"));
    for (const name of ["sources", "my_list"]) {
      assert.match(layout, new RegExp('android:id="@\\+id/btn_' + kind + '_' + name + '"'));
    }
    assert.match(layout, new RegExp('android:background="@drawable/charm_vod_detail_action_glass"'));
    assert.doesNotMatch(layout, new RegExp('android:id="@\\+id/btn_' + kind + '_favorite"[\\s\\S]{0,200}android:layout_height="0dp"'));
    assert.match(viewholder, new RegExp('binding\\.btn' + action + 'Sources'));
    assert.match(viewholder, /VodPreferences\.requestSourcesForNextPlayback\(\)/);
    assert.match(viewholder, new RegExp('binding\\.btn' + action + 'MyList'));
    assert.match(viewholder, new RegExp('btn' + action + 'Favorite\\.performClick\\(\\)'));
  }
});
