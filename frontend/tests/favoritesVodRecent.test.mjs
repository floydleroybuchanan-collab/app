import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Channels and Favorites lists use the same plain FlatList as Movies/Series", () => {
  for (const page of ["app/(tabs)/channels.tsx", "app/(tabs)/favorites.tsx"]) {
    const source = read(page);
    // On device a panel wrapper or a style on the list left it 1px tall (rows
    // clipped away). The Movies/Series grid, with no list style, renders.
    const list = source.slice(source.indexOf("<FlatList"), source.indexOf("renderItem=", source.indexOf("<FlatList")));
    assert.ok(list.length > 0, page);
    assert.doesNotMatch(list, /\n\s*style=/, page);
    assert.doesNotMatch(source, /listPanel|listFill/, page);
  }
  const movies = read("src/components/PurpleChannelCollection.tsx");
  const grid = movies.slice(movies.indexOf("<FlatList"), movies.indexOf("renderItem=", movies.indexOf("<FlatList")));
  assert.doesNotMatch(grid, /\n\s*style=/);
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

test("VOD player: keys always reach the player, no badge or Skip intro, sane D-pad", () => {
  const coordinator = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodFocusCoordinator.kt");
  assert.match(coordinator, /if \(navigation\.currentDestination\?\.id == R\.id\.player\) \{[\s\S]{0,700}playerView\.requestFocus\(\)\s*playerView\.showController\(\)/);
  assert.match(coordinator, /if \(destination == R\.id\.player\) return playerView\(\)\?\.requestFocus\(\) == true/);
  assert.match(coordinator, /if \(destination == R\.id\.player\) return@OnGlobalFocusChangeListener/);
  assert.match(coordinator, /PARK_TICK_MS = 250L/);
  const activity = read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
  assert.match(activity, /val vodPlayerOnScreen = vodImmersive \|\|\s*\(vodInputOwner as\? CharmVodSurfaceManager\.Surface\)\?\.playerShown\(\) == true/);
  const player = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/player/PlayerTvFragment.kt");
  assert.match(player, /val show = requested && false/);
  assert.match(player, /binding\.tvPlatformOriginBadge\.visibility = View\.GONE\s*platformBadgeJob\?\.cancel\(\)/);
  assert.match(player, /exoPlayPause\.nextFocusDownId = R\.id\.btn_exo_stop/);
  const similar = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodPlayerSimilar.kt");
  assert.match(similar, /for \(id in TRANSPORT\) controls\.findViewById<View>\(id\)\?\.nextFocusUpId = rail\.id/);
  assert.doesNotMatch(similar, /nextFocusDownId = rail\.id/);
});

test("VOD pages: title links reuse the live view, readable episodes, UP finds the row above", () => {
  const root = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt");
  assert.match(root, /fun navigateTo\(section: String\) \{[\s\S]{0,400}titleDestination\(section\)\?\.let/);
  assert.match(root, /if \(section == "home" && titleDestination\(previous\) != null\) return/);
  const episode = read("android/vod/app/src/main/res/layout/item_episode_tv.xml");
  assert.match(episode, /tv_episode_info"\s+android:textColor="#D9C8F5"/);
  assert.match(episode, /tv_episode_released"\s+android:textColor="#C9B5EE"/);
  assert.match(episode, /app:layout_constraintTop_toBottomOf="@id\/tv_episode_released"/);
  const coordinator = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodFocusCoordinator.kt");
  assert.match(coordinator, /val above = nearestAbove\(content, current\)/);
  for (const page of ["fragments/tv_show/TvShowTvFragment.kt", "fragments/movie/MovieTvFragment.kt"])
    assert.match(read(`android/vod/app/src/main/java/com/streamflixreborn/streamflix/${page}`), /VodTitleBadge\.hideWhenScrolled\(this, binding\.tvPlatformInfoBadge\)/);
});

test("VOD player lays out its controls when they show (0x0 controls on device)", () => {
  const view = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/ui/PlayerTvView.kt");
  assert.match(view, /setControllerVisibilityListener\(ControllerVisibilityListener \{ visibility ->\s*if \(visibility == android\.view\.View\.VISIBLE\) scheduleLayoutPass\(\)/);
  assert.match(view, /if \(event\.action == KeyEvent\.ACTION_UP\) scheduleLayoutPass\(\)/);
  assert.match(view, /page\.measure\(\s*MeasureSpec\.makeMeasureSpec\(page\.width, MeasureSpec\.EXACTLY\)/);
  assert.match(view, /override fun onDetachedFromWindow\(\) \{\s*removeCallbacks\(layoutPass\)/);
});

test("UP prefers the nearest item on the page over leaving for the VOD top bar", () => {
  const coordinator = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodFocusCoordinator.kt");
  assert.match(coordinator, /val nativeOnPage = native != null && native !== current &&\s*VodFocusMemory\.isWithin\(content, native\) && isAbove\(native, current\)/);
  assert.match(coordinator, /if \(!nativeOnPage\) \{\s*val above = nearestAbove\(content, current\)/);
});
