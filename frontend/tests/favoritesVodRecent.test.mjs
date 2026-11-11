import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Channels and Favorites lists keep panel styling off the FlatList", () => {
  for (const page of ["app/(tabs)/channels.tsx", "app/(tabs)/favorites.tsx"]) {
    const source = read(page);
    // Border/radius on the FlatList itself drew no rows on Android (Fabric).
    assert.match(source, /<View style=\{styles\.listPanel\}>\s*<FlatList/, page);
    assert.match(source, /style=\{styles\.listFill\}/, page);
    assert.doesNotMatch(source, /<FlatList[^>]*style=\{styles\.listPanel\}/, page);
    assert.match(source, /listFill: \{ flex: 1 \}/, page);
  }
});

test("favorite folders rename by typing and delete only after confirming", () => {
  const source = read("app/(tabs)/favorites.tsx");
  assert.match(source, /<TextInput[\s\S]{0,200}onSubmitEditing=\{saveRename\}/);
  assert.match(source, /testID="favorites-folder-delete-confirm"/);
  assert.match(source, /testID="favorites-folder-delete-cancel"/);
  // No silent delete on long-press and no name cycling any more.
  assert.doesNotMatch(source, /onLongPress=\{\(\) => \{\s*if \(folderId === folder\.id\)/);
  assert.doesNotMatch(source, /nextFavoriteFolderName\(/);
  assert.match(source, /addFavoriteFolder\(nextNewFolderName\(favoriteFolders\)\)/);
});

test("new folder names reuse the first free number", async () => {
  // The core module is TypeScript with a path alias; check the rule textually.
  const core = read("src/core/favoriteFolders.ts");
  assert.match(core, /export function nextNewFolderName/);
  assert.match(core, /for \(let n = 1; n <= MAX_FAVORITE_FOLDERS \+ 1; n\+\+\)/);
});

test("Live TV lists recently watched VOD titles and opens them in VOD", () => {
  const home = read("app/(tabs)/index.tsx");
  assert.match(home, /Recently Watched On Demand/);
  assert.match(home, /useFocusEffect\([\s\S]{0,120}loadVodRecent\(\)/);
  assert.match(home, /resizeMethod="resize"/);
  assert.match(home, /pathname: "\/vod", params: \{ section: vodTitleSection\(item\) \}/);
  const vod = read("app/(tabs)/vod.tsx");
  assert.match(vod, /const VOD_TITLE_LINK = \/\^\(movie\|tv_show\):/);
  assert.match(vod, /startSection=\{startSectionFor\(section, pane\)\}/);
  const root = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt");
  assert.match(root, /"movie" -> R\.id\.movie to id/);
  assert.match(root, /coordinator\?\.focusIncomingPage\(\)/);
  const reader = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRecentForHost.kt");
  assert.match(reader, /movieDao\(\)\.getRecentlyWatched\(\)\.first\(\)/);
  assert.match(reader, /tvShowDao\(\)\.getRecentlyWatched\(\)\.first\(\)/);
  const pkg = read("android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt");
  assert.match(pkg, /listOf\(CharmVodHistoryModule\(context\)\)/);
});

test("opening a VOD title keeps focus inside VOD while the page loads", () => {
  const coordinator = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodFocusCoordinator.kt");
  // Park on the top bar before the focused card is removed...
  assert.match(coordinator, /if \(fromContent && destination\.id != R\.id\.player && destination\.id != R\.id\.providers\) \{[\s\S]{0,200}parkOnBar\(\)/);
  // ...take focus back if it slips to the app rail without a key...
  assert.match(coordinator, /!VodFocusMemory\.isWithin\(binding\.root, new\) && binding\.root\.isShown/);
  // ...and any remote key ends parking (LEFT/BACK to the rail still work).
  assert.match(coordinator, /cancelPendingRestore\(\)\s*\}\s*\/\/[^\n]*\n[^\n]*\n\s*cancelParking\(\)/);
  assert.match(coordinator, /fun dispose\(\) \{[\s\S]{0,160}cancelParking\(\)/);
});

test("VOD title pages put a readable glass panel behind the details", () => {
  for (const [file, p] of [["content_movie_tv.xml", "movie"], ["content_tv_show_tv.xml", "tv_show"]]) {
    const xml = read(`android/vod/app/src/main/res/layout/${file}`);
    const panel = xml.indexOf(`android:id="@+id/v_${p}_info_glass"`);
    // First child (drawn behind), from poster to edge, above the buttons.
    assert.ok(panel > 0 && panel < xml.indexOf(`android:id="@+id/iv_${p}_poster"`), file);
    assert.match(xml, new RegExp(`app:layout_constraintBottom_toTopOf="@id/btn_${p}_watch_now"`), file);
    assert.match(xml, /android:background="@drawable\/vod_info_glass"/, file);
    assert.match(xml, /android:textSize="30sp"\s+android:maxLines="2"\s+android:ellipsize="end"/, file);
    assert.match(xml, new RegExp(String.raw`id="@\+id/tv_${p}_overview"\s+android:textColor="#EDE3FF"`), file);
  }
});
