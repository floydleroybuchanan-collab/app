import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a touch phone gets the clear-page neon glass tokens; the TV tokens are untouched", () => {
  const theme = read("src/theme.ts");
  assert.match(theme, /const tvGlass = \{[^}]*?page: "transparent",\s*rail: "#1A0B33",[^}]*?drawer: "#2F1770"/);
  assert.match(theme, /Platform\.OS === "android" && !Platform\.isTV/);
  assert.match(theme, /page: "transparent"/);
  assert.match(theme, /export const glass: typeof tvGlass = phoneUi \? phoneGlassTokens : tvGlass/);
});

test("the player uses glass transport icons on a phone only", () => {
  const player = read("app/player.tsx");
  assert.match(player, /const phoneUi = usePhoneUi\(\);/);
  assert.match(player, /phoneUi \? <Image source=\{PLAYER_GLASS\.prev\}/);
  assert.match(player, /<Ionicons name="play-skip-back"/);
  for (const name of ["prev", "pause", "play", "next", "back"]) {
    assert.ok(existsSync(new URL(`../assets/glass/player_${name}.png`, import.meta.url)), `player_${name}.png`);
  }
});

test("phone layouts: 3-up channel cards, 2/3-up reminders, 3-up settings tiles, no TV drawer button, glass back button", () => {
  const collection = read("src/components/PurpleChannelCollection.tsx");
  assert.match(collection, /phoneUi \? \(width < 600 \? 3 : 4\) : width >= 1500 \? 6/);
  assert.match(read("app/(tabs)/reminders.tsx"), /phoneUi \? \(contentWidth < 600 \? 2 : 3\) : TV_COLUMNS/);
  assert.match(read("app/(tabs)/settings.tsx"), /tilePhone: \{ width: "31\.5%"/);
  assert.match(read("src/components/PurpleDrawerButton.tsx"), /if \(phoneUi\) return null;/);
  assert.match(read("app/player.tsx"), /testID="player-glass-back"/);
});

test("the native VOD settings rows are 40% see-through on a phone and unchanged on a TV", () => {
  const styler = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/SettingsListStyler.kt");
  assert.match(styler, /val rowBackgroundColor = if \(isTv\) 0x2E9A5CF0 else 0x999A5CF0\.toInt\(\)/);
});

test("secondary pages use the shared glass tokens, so a phone gets the phone look and a TV keeps its own", () => {
  for (const file of ["app/playlists.tsx", "app/epg-custom.tsx", "app/epg-source.tsx", "app/group-settings.tsx", "app/(tabs)/epg-sources.tsx", "app/(tabs)/settings.tsx"]) {
    const src = read(file);
    assert.doesNotMatch(src, /"rgba\(150,90,235,0\.18\)"|"rgba\(216,178,255,0\.30\)"|"rgba\(122,62,214,0\.13\)"/, file);
  }
  const theme = read("src/theme.ts");
  assert.match(theme, /export const ph = \(n: number\): number => \(phoneUi \? Math\.round\(n \* 1\.3 \* 2\) \/ 2 : n\)/);
  assert.match(read("app/playlists.tsx"), /minHeight: ph\(34\)/);
});

test("settings have no solid window behind the buttons, so the crown shows through", () => {
  const settings = read("app/(tabs)/settings.tsx");
  assert.match(settings, /tileGridWrap: \{ flex: 1, minHeight: 0, overflow: "hidden" \},/);
  assert.match(settings, /detailsWrap: \{ flex: 1 \},/);
  assert.doesNotMatch(settings, /rgba\(98,52,170,0\.82\)/);
});

test("native VOD player glass icons are phone-only: touch devices get the glass play/pause, the TV keeps its own", () => {
  const layout = read("android/vod/app/src/main/res/layout/content_exo_controller_mobile.xml");
  for (const name of ["ic_glass_back", "ic_glass_prev", "ic_glass_next"]) assert.match(layout, new RegExp(`@drawable/${name}`));
  assert.doesNotMatch(layout, /exo_play_pause"[^>]*tint/);
  for (const f of ["drawable-finger/exo_styled_controls_play.png", "drawable-finger/exo_styled_controls_pause.png", "drawable-nodpi/ic_glass_back.png"]) {
    assert.ok(existsSync(new URL(`../android/vod/app/src/main/res/${f}`, import.meta.url)), f);
  }
  const tv = read("android/vod/app/src/main/res/layout/content_exo_controller_tv.xml");
  assert.doesNotMatch(tv, /ic_glass_/);
});

test("drawers are solid, the crown background is behind every screen, and the phone chrome works with a remote", () => {
  const theme = read("src/theme.ts");
  assert.match(theme, /drawer: "#2F1770"/);
  const chrome = read("src/components/PhoneChrome.tsx");
  assert.doesNotMatch(chrome, /focusable=\{false\}[\s\S]{0,40}onPress=\{item\.press\}/);
  assert.match(chrome, /hasTVPreferredFocus=\{index === 0\}/);
  assert.match(chrome, /<FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight/);
  assert.match(chrome, /crown_backdrop\.png/);
  assert.ok(existsSync(new URL("../assets/medialab/crown_backdrop.png", import.meta.url)));
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(shell, /<PhoneBackdrop \/>/);
  assert.match(shell, /trapFocusDown=\{!bottomBar && /);
});

test("fullscreen video is not pushed down by the safe-area padding", () => {
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(shell, /edges\.padding\.top \+ \(phone && !immersiveContent \? insets\.top : 0\)/);
});

test("the loading and sign-in scenes animate on first launch and use 1080p loops", () => {
  for (const f of ["src/components/StartupScene.tsx", "src/components/LoginScene.tsx", "src/components/AccountLoginBrand.tsx"]) {
    assert.match(read(f), /AppState\.currentState !== "background"/, f);
  }
  const size = (f) => readFileSync(new URL(`../assets/login/${f}`, import.meta.url)).length;
  // The sign-in scene is a still background + a transparent foreground cutout layer now
  // (both WebP, lossy at near-lossless quality), not a video or an animated-loop file -
  // see loginScene.test.mjs.
  assert.ok(size("scene_bg.webp") > 50_000);
  assert.ok(size("scene_bg.webp") < 2_000_000);
  assert.ok(size("scene_foreground.webp") > 50_000);
  assert.ok(size("scene_foreground.webp") < 2_000_000);
  assert.ok(size("startup_move.webp") > 5_000_000);
  // The WebP header carries the canvas size: width-1 and height-1 as 24-bit little-endian at bytes 24 and 27.
  const dims = (f) => { const b = readFileSync(new URL(`../assets/login/${f}`, import.meta.url)).subarray(0, 40); return [(b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1]; };
  assert.deepEqual(dims("startup_back.webp"), [1920, 1080]);
  assert.deepEqual(dims("startup_move.webp"), [1440, 810]);
});

test("embedded VOD gets the crown background and the glass bottom bar", () => {
  assert.match(read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt"), /b\.root\.background = CrownBackdrop\(requireContext\(\)\)/);
  const base = "android/vod/app/src/main/java/com/streamflixreborn/streamflix";
  assert.match(read(`${base}/charm/CrownBackdrop.kt`), /class CrownBackdrop\(context: Context\) : Drawable\(\)/);
  assert.match(read(`${base}/activities/main/MainMobileActivity.kt`), /binding\.root\.background = com\.streamflixreborn\.streamflix\.charm\.CrownBackdrop\(this\)/);
  assert.match(read(`${base}/activities/main/MainMobileActivity.kt`), /binding\.bnvMain\.background = glassBar/);
  assert.match(read(`${base}/activities/main/MainTvActivity.kt`), /CrownBackdrop\(this\)/);
  assert.match(read(`${base}/activities/main/MainTvActivity.kt`), /vodGlassActions\.setBackgroundColor\(android\.graphics\.Color\.TRANSPARENT\)/);
});

test("the Guide and On Demand buttons use the new glass TV and VOD icons on the rail, drawer and phone bar", () => {
  const chrome = read("src/components/PhoneChrome.tsx");
  assert.match(chrome, /guide: require\("\.\.\/\.\.\/assets\/glass\/nav_tv\.png"\)/);
  assert.match(chrome, /vod: require\("\.\.\/\.\.\/assets\/glass\/nav_vod\.png"\)/);
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(shell, /route: "\/guide", label: "TV Guide", art: require\("\.\.\/\.\.\/assets\/glass\/nav_tv\.png"\)/);
  assert.match(shell, /route: "\/vod", label: "Video OnDemand", art: require\("\.\.\/\.\.\/assets\/glass\/nav_vod\.png"\)/);
  for (const f of ["nav_tv.png", "nav_vod.png"]) {
    const png = readFileSync(new URL(`../assets/glass/${f}`, import.meta.url));
    // PNG colour type 6 = RGBA, so the background is transparent.
    assert.equal(png[25], 6, f);
  }
});

test("the native Guide has genre-coloured glass cells, a TV icon for logo-less channels and a clear background on TV and phone", () => {
  const view = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /private fun tintFor\(program: NativeEpgProgram\): Paint/);
  assert.match(view, /private val cellRadius = 12f \* density/);
  assert.match(view, /private fun drawTvIcon\(canvas: Canvas, left: Float, top: Float, size: Float\)/);
  assert.doesNotMatch(view, /TILE_COLORS/);
  assert.match(view, /canvas\.drawText\("Today", pad, headerHeight \* \.66f, headerLabel\)/);
  assert.match(view, /private val elapsedShade/);
});

test("the Series button has its own icon, and every new icon has a fully transparent background", () => {
  assert.match(read("src/components/PhoneChrome.tsx"), /shows: require\("\.\.\/\.\.\/assets\/glass\/nav_series\.png"\)/);
  assert.match(read("src/components/PurpleTvShell.tsx"), /route: "\/series", label: "Series", art: require\("\.\.\/\.\.\/assets\/glass\/nav_series\.png"\)/);
  for (const f of ["nav_tv.png", "nav_vod.png", "nav_series.png", "player_back.png", "player_prev.png", "player_pause.png", "player_play.png", "player_next.png"]) {
    const png = readFileSync(new URL(`../assets/glass/${f}`, import.meta.url));
    assert.equal(png[25], 6, `${f} must be RGBA`);
  }
});

test("the Guide has the approved top row on a phone: back, group, more and a search pill", () => {
  const bar = read("src/components/GuideTopBar.tsx");
  for (const id of ["guide-top-back", "guide-top-group", "guide-top-more", "guide-top-search"]) assert.match(bar, new RegExp(`testID="${id}"`));
  assert.match(bar, /Search by program name/);
  const guide = read("app/(tabs)/guide.tsx");
  assert.match(guide, /\{phoneUi && channels\.length > 0 \? \(\s*<GuideTopBar/);
  assert.match(guide, /onGroups=\{\(\) => setGroupDrawerOpen\(true\)\}/);
});

test("pages no longer paint their own backdrop over the crown, and the TV icon rail is violet glass, not near-black", () => {
  assert.match(read("src/components/GlassBackdrop.tsx"), /return null;/);
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.match(shell, /backgroundColor: "#2F1770",\s*borderWidth: 2,/);
  assert.match(shell, /railPlaceholder: \{ width: PURPLE_ICON_RAIL_WIDTH \+ 6/);
});

test("see-through glass has no elevation: Android draws it as a purple box behind the icon and label", () => {
  assert.doesNotMatch(read("src/components/PhoneChrome.tsx"), /elevation: [1-9]/);
  assert.match(read("src/theme.ts"), /elevation: 0,\s*\} as const/);
  assert.doesNotMatch(read("app/(tabs)/settings.tsx"), /elevation: [1-9]/);
});

test("BACK from a stream keeps the chosen Guide group: no reset while the lists load, no switch to an unknown playlist", () => {
  const guide = read("app/(tabs)/guide.tsx");
  assert.match(guide, /const \[groupsSettled, setGroupsSettled\] = useState\(false\)/);
  assert.match(guide, /if \(!groupsSettled\) return;\s*if \(!groups\.includes\(group\)/);
  assert.match(guide, /playlistsRef\.current\.some\(\(item\) => item\.id === jumpOwner && item\.enabled\)\) selectPlaylist\(jumpOwner\)/);
});

test("the Settings buttons are 50% see-through on phone and TV", () => {
  assert.match(read("app/(tabs)/settings.tsx"), /tile: \{[^}]*backgroundColor: "rgba\(130,72,212,0\.50\)"/);
});

test("the icon rail has no dark box of its own, and the drawers are solid violet with glass rows", () => {
  const shell = read("src/components/PurpleTvShell.tsx");
  assert.doesNotMatch(shell, /<MediaLabBackdrop/);
  assert.match(shell, /borderTopRightRadius: 28,\s*borderBottomRightRadius: 28,/);
  assert.match(shell, /backgroundColor: "rgba\(190,140,255,0\.14\)"/);
  const groups = read("src/components/PurpleGuideGroupDrawer.tsx");
  assert.match(groups, /borderTopRightRadius: 28,\s*borderBottomRightRadius: 28,/);
  assert.match(groups, /backgroundColor: "rgba\(190,140,255,0\.10\)"/);
});

test("the phone Guide is a readable list: compact native layout, no live preview, and Up reaches the top row", () => {
  const guide = read("app/(tabs)/guide.tsx");
  assert.match(guide, /\{phoneUi \? null : \(\s*<GuideSelectionPreview/);
  assert.match(guide, /compact=\{phoneUi\}\s*enableUpBoundary=\{!phoneUi\}/);
  assert.match(read("src/components/NativeGuideCanvas.tsx"), /compact=\{compact\}/);
  const view = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /fun setCompact\(value: Boolean\)/);
  assert.match(view, /visibleWindowMs = if \(!compact\) 3L \* 60L \* 60_000L else if \(h > w\) 90L \* 60_000L else 120L \* 60_000L/);
  assert.match(view, /if \(!compact\) drawChannelName\(canvas, row\.label/);
  assert.match(read("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"), /name = "compact"/);
});

test("the player's Quick Actions reach it on a phone (Aspect ratio used to do nothing) and the phone has an Aspect button", () => {
  const player = read("app/player.tsx");
  assert.doesNotMatch(player, /if \(!isTV\) return;\s*return addPlayerQuickCommandListener/);
  assert.match(player, /return addPlayerQuickCommandListener\(\(command\) => \{/);
  assert.match(player, /testID="player-aspect-ratio" onPress=\{openAspectPicker\}/);
  // The embedded VOD player's own aspect button now opens AspectPicker rather than cycling in place
  // (see the dedicated AspectPicker test below for the full picture).
  const vod = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/player/PlayerTvFragment.kt");
  assert.match(vod, /AspectPicker\.show\(/);
  assert.doesNotMatch(vod, /UserPreferences\.PlayerResize\.Fit -> UserPreferences\.PlayerResize\.Fill/);
});

test("Aspect ratio opens a drawer of choices (on any device) instead of silently cycling, and each choice becomes the new default", () => {
  const player = read("app/player.tsx");
  assert.match(player, /command === "CYCLE_ASPECT"[\s\S]{0,60}return openAspectPicker\(\)/);
  assert.match(player, /const ASPECT_OPTIONS: \{ mode: PlayerViewMode; label: string; help: string \}\[\] = \[/);
  for (const mode of ["fit", "fill", "zoom", "zoomWidth", "zoomHeight"]) assert.ok(player.includes(`{ mode: "${mode}"`), mode);
  assert.match(player, /testID="player-aspect-picker"/);
  // A floating card over the video, not an in-flow panel that pushes the transport controls.
  assert.match(player, /aspectOverlay: \{ \.\.\.StyleSheet\.absoluteFillObject, alignItems: "center", justifyContent: "center"/);
  assert.doesNotMatch(player, /\{aspectOpen \? \(\s*<View style=\{styles\.tracksPanel\}/);
  assert.match(player, /setPlayerAspectMode\(mode\);/);
  assert.match(player, /playerAspectMode,\s*setPlayerAspectMode,/);
  const store = read("src/store.tsx");
  assert.match(store, /const PLAYER_ASPECT_KEY = "gs_player_aspect_mode";/);
  assert.match(store, /setPlayerAspectModeState\(v\);\s*storage\.setItem\(PLAYER_ASPECT_KEY, v\);/);
});

test("every command the Quick Actions drawer sends to the player has a handler in the player, on any device", () => {
  const remote = read("src/utils/tvRemote.ts");
  const typeLine = remote.match(/export type PlayerQuickCommand = ([^;]+);/)?.[1] || "";
  const commands = [...typeLine.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(commands.sort(), ["CYCLE_ASPECT", "OPEN_TRACKS", "PREVIOUS_CHANNEL", "SAVE_DIAGNOSTICS"]);
  const player = read("app/player.tsx");
  const overlay = read("src/components/TvQuickActionsOverlay.tsx");
  for (const command of commands) {
    assert.ok(overlay.includes(`runPlayerCommand("${command}")`), `${command} is sent by the drawer`);
    assert.ok(player.includes(`command === "${command}"`), `${command} is handled by the player`);
  }
  // The handler must not be limited to a TV.
  assert.doesNotMatch(player, /if \(!isTV\) return;\s*\/\/ Quick Actions/);
});

test("a touch phone gets the mobile VOD screens in the same embedded surface; the TV host is left alone", () => {
  const vodTab = read("app/(tabs)/vod.tsx");
  assert.match(vodTab, /phone\?: boolean/);
  assert.match(vodTab, /phone=\{phoneUi\}/);
  const surface = read("android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt");
  assert.match(surface, /@ReactProp\(name = "phone"\)/);
  assert.match(surface, /if \(phone\) \{\s*mountPhone\(host, fm\)/);
  assert.match(surface, /VodRootFragment\.create\(startSection\)/);
  const phone = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootMobileFragment.kt");
  assert.match(phone, /nav_main_graph_phone/);
  assert.match(phone, /CrownBackdrop\(requireContext\(\)\)/);
  assert.doesNotMatch(phone, /R\.id\.providers/);
  assert.match(phone, /bnvMain\.visibility = View\.GONE/);
  for (const section of ["Home", "Movies", "TV Shows", "My List", "Search", "Settings"]) assert.ok(phone.includes(`"${section}"`), section);
  const tv = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt");
  assert.match(tv, /nav_main_graph_tv/);
  assert.doesNotMatch(tv, /nav_main_graph_(mobile|phone)/);
});

test("the phone VOD has Genres, Platforms, platform pages and a platform row on Home, with the crown showing through", () => {
  const graph = read("android/vod/app/src/main/res/navigation/nav_main_graph_phone.xml");
  for (const id of ["genre_hub", "platforms", "platform_titles"]) assert.ok(graph.includes(`android:id="@+id/${id}"`), id);
  assert.match(graph, /charm\.VodGenresHubFragment/);
  assert.match(graph, /charm\.VodPlatformsFragment/);
  const phone = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootMobileFragment.kt");
  for (const label of ["Genres", "Platforms"]) assert.ok(phone.includes(`"${label}"`), label);
  assert.match(phone, /section == "genres" -> R\.id\.genre_hub/);
  assert.match(phone, /section == "platforms" -> R\.id\.platforms/);
  const home = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/home/HomeMobileFragment.kt");
  assert.match(home, /parentFragment\?\.parentFragment is com\.streamflixreborn\.streamflix\.charm\.VodRootMobileFragment/);
  assert.match(home, /VodPhoneHomeStrip\.attach/);
  for (const f of ["VodPlatformsFragment", "VodGenresHubFragment"]) {
    const src = read(`android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/${f}.kt`);
    assert.match(src, /is VodRootMobileFragment\) 0 else 0xFF120A20/, `${f} is see-through on a phone, unchanged on TV`);
  }
});

test("tapping Genres or Platforms on the phone used to crash the whole app (wrong nav graph auto-attached)", () => {
  // activity_main_mobile.xml's own <fragment> tag hardcodes the standalone app's nav_main_graph_mobile,
  // which has no genre_hub/platforms/platform_titles. That layout's inflation auto-attaches a
  // NavHostFragment with THAT graph before VodRootMobileFragment's own code runs, so
  // findFragmentById found it first and the "create with nav_main_graph_phone" fallback never fired -
  // confirmed live via logcat: IllegalArgumentException, "destination ... genre_hub cannot be found
  // from the current destination ... HomeMobileFragment", thrown from NavController.navigate, called
  // from VodRootMobileFragment.openSection, called from the Genres/Platforms pill's onClick.
  const layout = read("android/vod/app/src/main/res/layout/activity_main_mobile.xml");
  assert.match(layout, /app:navGraph="@navigation\/nav_main_graph_mobile"/);
  const mobileGraph = read("android/vod/app/src/main/res/navigation/nav_main_graph_mobile.xml");
  for (const id of ["genre_hub", "platforms", "platform_titles"]) assert.doesNotMatch(mobileGraph, new RegExp(`android:id="@\\+id/${id}"`));
  const phone = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootMobileFragment.kt");
  assert.match(phone, /if \(controller\.graph\.id != R\.id\.nav_main_graph_phone\) controller\.setGraph\(R\.navigation\.nav_main_graph_phone\)/);
  const phoneGraph = read("android/vod/app/src/main/res/navigation/nav_main_graph_phone.xml");
  assert.match(phoneGraph, /android:id="@\+id\/nav_main_graph_phone"/);
});

test("phone Live TV is Cards only with pop-down pickers; the Guide is TV only; the TV list stays", () => {
  const hub = read("src/components/PhoneLiveHub.tsx");
  for (const id of ["phone-live-playlist", "phone-live-group", "phone-live-search", "phone-live-manage", "phone-live-add"]) assert.ok(hub.includes(id), id);
  assert.doesNotMatch(hub, /phone-live-mode|Full timeline Guide|GuideRow/);
  assert.match(hub, /Categories/);
  // "What's Next" is its own labelled row under the status bar, not folded into the "until" line.
  assert.match(hub, /What&rsquo;s Next<\/Text>/);
  assert.match(hub, /\{next\.title\}<\/Text>/);
  assert.match(hub, /until \$\{ends\}/);
  // No logo: the whole channel name, not a few letters.
  assert.match(hub, /\{channel\.name\}<\/Text>\s*\)\}\s*<\/LinearGradient>/);
  // The guide data for the rows on screen is requested, so "what's on" fills in.
  assert.match(hub, /patchProgramsForChannelIds/);
  assert.match(hub, /buildPlaylistMenu\(/);
  const channels = read("app/(tabs)/channels.tsx");
  assert.match(channels, /phoneUi \? <PhoneChannelsScreen \/> : <ChannelsScreenContent \/>/);
  const chrome = read("src/components/PhoneChrome.tsx");
  assert.doesNotMatch(chrome, /label: "Guide"/);
  const guide = read("app/(tabs)/guide.tsx");
  assert.match(guide, /if \(usePhoneUi\(\)\) return <Redirect href=\{"\/channels" as any\} \/>;/);
  const vod = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootMobileFragment.kt");
  assert.match(vod, /setOnClickListener \{ navigateBack\(\) \}/);
  assert.match(vod, /backPill\?\.visibility = if \(top\) View\.GONE else View\.VISIBLE/);
});

test("phone VOD is safe inside the app: starts at Home, embedded Settings, Back pops pages, no side drawer", () => {
  const dir = "android/vod/app/src/main/res/navigation/";
  const phoneGraph = read(dir + "nav_main_graph_phone.xml");
  assert.match(phoneGraph, /app:startDestination="@id\/home"/);
  // The mobile Settings screen restarts the standalone VOD activity on a theme or language change: never in the app.
  assert.match(phoneGraph, /fragments\.settings\.SettingsTvFragment/);
  assert.doesNotMatch(phoneGraph, /SettingsMobileFragment|SettingsAboutMobileFragment/);
  assert.match(read(dir + "nav_main_graph_mobile.xml"), /app:startDestination="@id\/providers"/);
  const phone = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootMobileFragment.kt");
  assert.match(phone, /fun canGoBack\(\): Boolean/);
  assert.match(phone, /private fun settingsArgs\(section: String\)/);
  const main = read("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
  assert.match(main, /phoneCanGoBack\(\) == true/);
  assert.match(main, /\(nativeVodOwnsFocus\(\) \|\| phoneVodHasBack\) && vodBackHandler\?\.invoke\(\) == true/);
  const tab = read("app/(tabs)/vod.tsx");
  assert.match(tab, /if \(phoneUi\) \{\s*router\.replace\("\/" as any\);\s*return;\s*\}\s*openDrawer\(\{ force: true \}\);/);
});

test("phone Live TV home uses the same cards, and the cards ask for the guide data they show", () => {
  const home = read("app/(tabs)/index.tsx");
  assert.match(home, /phoneUi \? \(/);
  assert.match(home, /<ChannelCard channel=\{channel\}/);
  assert.match(home, /if \(phoneUi\) retainGuideSlidingCache\(ids\);/);
  const hub = read("src/components/PhoneLiveHub.tsx");
  assert.match(hub, /retainRef\.current\(ids\);/);
  assert.match(hub, /const cardColumns = landscape \? 5 : 3;/);
  assert.match(hub, /function withSpacers/);
  assert.match(hub, /key=\{landscape \? "cards-l" : "cards"\}/);
  assert.match(hub, /if \(!isFocused\) return;\s*const sub = BackHandler/);
  assert.match(hub, /BackHandler\.addEventListener\("hardwareBackPress"/);
});

test("TV Guide: channel boxes are 20% narrower, logo-less channels get a TV icon, names wrap beside the icon", () => {
  const view = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /private var channelWidth = 148f \* density/);
  assert.match(view, /channelWidth = \(if \(value\) 80f else 148f\) \* density/);
  assert.match(view, /private fun drawTvIcon\(/);
  assert.match(view, /private fun drawChannelName\(/);
  assert.doesNotMatch(view, /TILE_COLORS|tileFill/);
  // The text starts after the icon, so it can never run under it.
  assert.match(view, /drawChannelName\(canvas, row\.label, pad \+ logoSpace, top, channelWidth - pad\)/);
});

test("Settings has a Default aspect ratio row for the Live TV player, matching the in-player drawer", () => {
  const settings = read("app/(tabs)/settings.tsx");
  assert.match(settings, /label="Default aspect ratio"/);
  assert.match(settings, /value=\{playerAspectMode\}/);
  assert.match(settings, /onChange=\{setPlayerAspectMode\}/);
  for (const mode of ["fit", "fill", "zoom", "zoomWidth", "zoomHeight"]) assert.ok(settings.includes(`value: "${mode}"`), mode);
});

test("the embedded VOD player's Aspect ratio button opens the same named-choices window on TV and on phone, with the same five modes the Live TV player offers", () => {
  const picker = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/vod/AspectPicker.kt");
  assert.match(picker, /object AspectPicker/);
  assert.match(picker, /fun show\(/);
  // A fixed, generous floating-card width instead of the AlertDialog's unreliable OEM-theme default.
  assert.match(picker, /setLayout\(cardWidth, ViewGroup\.LayoutParams\.WRAP_CONTENT\)/);
  const prefs = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/utils/UserPreferences.kt");
  assert.match(prefs, /val PLAYER_RESIZE_CHOICES: List<PlayerResize> = listOf\(\s*PlayerResize\.Fit, PlayerResize\.Fill, PlayerResize\.Zoom, PlayerResize\.ZoomWidth, PlayerResize\.ZoomHeight,/);
  // The getter must never fall back to resizeMode-alone matching when a name was saved: three
  // deprecated modes all reuse RESIZE_MODE_FIT, and that fallback always resolved to Fit first.
  assert.match(prefs, /get\(\) = Key\.PLAYER_RESIZE_NAME\.getString\(\)\?\.let \{ saved -> PlayerResize\.entries\.find \{ it\.name == saved \} \}/);
  const tv = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/player/PlayerTvFragment.kt");
  assert.match(tv, /AspectPicker\.show\(\s*this@PlayerTvFragment,\s*UserPreferences\.playerResize,\s*UserPreferences\.PLAYER_RESIZE_CHOICES,/);
  const mobile = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/player/PlayerMobileFragment.kt");
  assert.match(mobile, /AspectPicker\.show\(this@PlayerMobileFragment, UserPreferences\.playerResize, UserPreferences\.PLAYER_RESIZE_CHOICES\)/);
});

test("VOD Settings keeps its phone-appropriate row styling now that phones reuse the TV settings screen", () => {
  const settings = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/SettingsTvFragment.kt");
  assert.match(settings, /private fun isEmbeddedOnPhone\(\): Boolean =\s*parentFragment\?\.parentFragment is com\.streamflixreborn\.streamflix\.charm\.VodRootMobileFragment/);
  assert.match(settings, /SettingsListStyler\.attach\(view, isTv = !isEmbeddedOnPhone\(\)\)/);
  assert.doesNotMatch(settings, /SettingsListStyler\.attach\(view, isTv = true\)/);
  const styler = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/SettingsListStyler.kt");
  assert.match(styler, /0x999A5CF0/);
});

test("the phone page title is gated to the phone host, not drawn on TV", () => {
  const header = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodPhoneHeader.kt");
  assert.match(header, /object VodPhoneHeader/);
  assert.match(header, /fragment\.parentFragment\?\.parentFragment !is VodRootMobileFragment/);
});

test("Movies and TV Shows on a phone get a genre filter row under the title, built from genres actually loaded", () => {
  const header = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodPhoneHeader.kt");
  assert.match(header, /fun attach\(fragment: Fragment, root: ViewGroup, content: View, title: String\): LinearLayout\?/);
  assert.match(header, /connect\(content\.id, ConstraintSet\.TOP, container\.id, ConstraintSet\.BOTTOM\)/);
  const chips = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodPhoneGenreChips.kt");
  assert.match(chips, /object VodPhoneGenreChips/);
  assert.match(chips, /addChip\("All", null\)/);
  const movies = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/movies/MoviesMobileFragment.kt");
  assert.match(movies, /VodPhoneHeader\.attach\(this, binding\.root, binding\.rvMovies, "Movies"\)\?\.let \{ header ->/);
  assert.match(movies, /VodPhoneGenreChips\.attach\(\s*this, header, \{ movie: Movie -> movie\.genres\.map \{ it\.name \} \},/);
  assert.match(movies, /allMovies\.filter \{ movie -> movie\.genres\.any \{ it\.name == genre \} \}/);
  const shows = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/tv_shows/TvShowsMobileFragment.kt");
  assert.match(shows, /VodPhoneHeader\.attach\(this, binding\.root, binding\.rvTvShows, "TV Shows"\)\?\.let \{ header ->/);
  assert.match(shows, /allTvShows\.filter \{ show -> show\.genres\.any \{ it\.name == genre \} \}/);
});

test("My List (phone Favorites) shows its own title beside the existing reorder buttons, without covering them", () => {
  const xml = read("android/vod/app/src/main/res/layout/fragment_favorites_mobile.xml");
  assert.match(xml, /android:id="@\+id\/tv_favorites_title"/);
  assert.match(xml, /android:text="@string\/favorites_title_phone"/);
  assert.match(xml, /app:layout_constraintEnd_toStartOf="@id\/btn_favorites_reorder_mode"/);
  const strings = read("android/vod/app/src/main/res/values/strings.xml");
  assert.match(strings, /<string name="favorites_title_phone">My List<\/string>/);
});

test("the shared mobile Watch Now / secondary buttons (Home hero, movie/show pages, retry) are the violet glass pill, not the old flat white rectangle", () => {
  const primary = read("android/vod/app/src/main/res/drawable/bg_button_mobile.xml");
  assert.match(primary, /android:radius="24dp"/);
  assert.match(primary, /android:color="#CC9A5CF0"/);
  assert.doesNotMatch(primary, /android:radius="4dp"/);
  const secondary = read("android/vod/app/src/main/res/drawable/bg_button_secondary_mobile.xml");
  assert.match(secondary, /android:radius="24dp"/);
  assert.match(secondary, /android:color="#59965AEB"/);
  const style = read("android/vod/app/src/main/res/values/style.xml");
  assert.match(style, /<style name="AppTheme\.Widget\.Mobile\.Button" parent="AppTheme\.Mobile">[\s\S]{0,500}<item name="android:textColor">#FFFFFF<\/item>\s*<\/style>/);
});

test("the phone/TV screen choice is reactive (usePhoneUi), not a frozen constant, so a Device Layout change takes effect without a real process restart", () => {
  const tvLayout = read("src/utils/tvLayout.ts");
  assert.match(tvLayout, /export function usePhoneUi\(\): boolean \{/);
  assert.match(tvLayout, /const \{ deviceLayoutMode \} = useStore\(\);/);
  const files = {
    "app/(tabs)/channels.tsx": /const phoneUi = usePhoneUi\(\);/,
    "app/(tabs)/guide.tsx": /const phoneUi = usePhoneUi\(\);/,
    "app/(tabs)/index.tsx": /const phoneUi = usePhoneUi\(\);/,
    "app/(tabs)/reminders.tsx": /const phoneUi = usePhoneUi\(\);/,
    "app/(tabs)/settings.tsx": /const phoneUi = usePhoneUi\(\);/,
    "app/(tabs)/vod.tsx": /const phoneUi = usePhoneUi\(\);/,
    "app/player.tsx": /const phoneUi = usePhoneUi\(\);/,
    "src/components/PurpleChannelCollection.tsx": /const phoneUi = usePhoneUi\(\);/,
    "src/components/PurpleDrawerButton.tsx": /const phoneUi = usePhoneUi\(\);/,
  };
  for (const [path, pattern] of Object.entries(files)) {
    const src = read(path);
    assert.match(src, pattern, path);
    // None of these import the frozen theme.ts constant any more.
    assert.doesNotMatch(src, /\{[^}]*\bphoneUi\b[^}]*\} from "@\/src\/theme"/, path);
  }
  // VOD's native surface remounts immediately on a Device Layout change instead of waiting for the tab to be left and reopened.
  const vod = read("app/(tabs)/vod.tsx");
  assert.match(vod, /key=\{`\$\{attempt\}-\$\{phoneUi\}`\}/);
});

test("the phone bottom bar and side rail cannot take D-pad/remote focus (a connected remote's Down used to jump focus straight to the bar)", () => {
  const chrome = read("src/components/PhoneChrome.tsx");
  const barMatches = [...chrome.matchAll(/focusable=\{false\}/g)];
  // The bar's tabs, the More button, and the side rail's items: three, plus the existing scrim.
  assert.ok(barMatches.length >= 4, `expected at least 4 focusable={false}, found ${barMatches.length}`);
  assert.match(chrome, /onPress=\{\(\) => onNavigate\(tab\.route\)\}\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*focusable=\{false\}/);
  assert.match(chrome, /accessibilityLabel="More"\s*\n\s*onPress=\{onMore\}\s*\n\s*focusable=\{false\}/);
  assert.match(chrome, /onPress=\{item\.press\}\s*\/\/[^\n]*\n\s*focusable=\{false\}/);
});

test("a second, independent frozen isTV flag cannot re-split TV and phone chrome (found in a full-app scan after the usePhoneUi fix)", () => {
  // These also decided WHICH screen/component renders from a local isTV
  // derived straight from the frozen Platform.isTV, instead of the one live
  // usePhoneUi() signal every other screen already uses - so they could still
  // show stale TV-or-phone content after a Device Layout change with no restart.
  // app/_layout.tsx is the one exception: RootLayout renders GuideProvider as a
  // descendant, so RootLayout itself is never inside it and usePhoneUi() (which
  // needs useStore()'s context) throws there - confirmed by a real crash on
  // launch ("useStore must be used inside GuideProvider"). It must keep reading
  // the platform's own raw TV flag instead.
  const layout = read("app/_layout.tsx");
  assert.match(layout, /const isTV = Platform\.OS !== "web" && !!Platform\.isTV;/);

  const player = read("app/player.tsx");
  assert.match(player, /const phoneUi = usePhoneUi\(\);\s*\n\s*const isTV = !phoneUi;/);

  const search = read("app/(tabs)/search.tsx");
  assert.match(search, /const isTV = !usePhoneUi\(\);/);

  const calibration = read("src/components/TvCalibrationControls.tsx");
  assert.match(calibration, /const phoneUi = usePhoneUi\(\);/);
  assert.match(calibration, /if \(phoneUi\) \{/);
  assert.doesNotMatch(calibration, /Platform\.isTV/);
});

test("a connected remote/keyboard's D-pad can control the player on a phone too, not just on TV", () => {
  // These used to bail out with `if (!isTV) return;`, so a phone (BlueStacks, an Android TV box
  // forced into Mobile layout, a Bluetooth remote) had no focus to land on and no listener for a
  // bare D-pad press: the player looked like it ignored the remote entirely.
  const player = read("app/player.tsx");
  assert.match(player, /\/\/ Not isTV-gated: a touch phone can still have a connected remote\/keyboard/);
  assert.match(player, /const claimControlsFocus = useCallback\(\(\) => \{\s*cancelFocusRef\.current\?\.\(\);\s*\/\/ Not isTV-gated: without this, a connected remote\/keyboard had nowhere to land/);
  assert.match(player, /\/\/ Not isTV-gated: without this, a connected remote\/keyboard's D-pad press in the player did\s*\/\/ nothing at all on a phone - there was no listener here to reveal the hidden controls\.\s*return addTvKeyListener/);
  assert.match(player, /if \(!aspectOpen\) return;/);
  assert.match(player, /if \(!tracksOpen\) return;/);
  assert.match(player, /<FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style=\{styles\.aspectCard\}/);
});

test("the phone Live TV / Channels screen (PhoneLiveHub) gives a connected remote's D-pad an initial focus target", () => {
  // Without an initial hasTVPreferredFocus, Android's D-pad focus search had nothing to start
  // from on this screen, so nothing ever appeared focused and the remote seemed dead.
  const hub = read("src/components/PhoneLiveHub.tsx");
  assert.match(hub, /onPress=\{\(\) => setPanel\(panel === "playlists" \? null : "playlists"\)\}\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*hasTVPreferredFocus\s*\n/);
});

test("the player's aspect-ratio/tracks/channels overlays give a connected remote's D-pad an initial focus target", () => {
  // Reported live on video: opening the aspect-ratio picker left the Channels tab behind it still
  // showing the focus ring, and nothing in the card ever did - the D-pad had nowhere to go. The
  // imperative requestNativeFocusWithRetry(aspectFirstRowRef...) effect alone wasn't enough (see
  // the tvFocus.ts test below for why); hasTVPreferredFocus is the pattern already proven to work
  // elsewhere in this app (PhoneLiveHub, PhoneMoreSheet), so every overlay opened on top of
  // already-focused controls gets it too.
  const player = read("app/player.tsx");
  const aspectRows = player.slice(player.indexOf("{ASPECT_OPTIONS.map((option, index)"), player.indexOf("</FocusGuide>", player.indexOf("{ASPECT_OPTIONS.map((option, index)")));
  assert.match(aspectRows, /ref=\{index === 0 \? aspectFirstRowRef : undefined\}\s*\n\s*hasTVPreferredFocus=\{index === 0\}/);
  assert.match(player, /<Pressable ref=\{subtitlesOffRef\} hasTVPreferredFocus onPress=\{\(\) => setTextTrackId\(undefined\)\}/);
  assert.match(player, /renderItem=\{\(\{ item, index \}\) => \(\s*\n\s*<Pressable hasTVPreferredFocus=\{index === 0\}/);
});

test("requestNativeFocus also tries the TV ViewManager command off an actual TV-flagged build", () => {
  // app.json's native TV build flag is false for this whole app (one APK serves both the phone and
  // TV screen layouts, chosen at runtime, not at the native/build level), so react-native-tvos's
  // Platform.isTV is false everywhere - the dispatchViewManagerCommand branch used to never run at
  // all, anywhere, in production: every call silently fell through to the generic `.focus()`, a
  // documented no-op for a Pressable. That's the real root cause behind the test above.
  const tvFocus = read("src/utils/tvFocus.ts");
  const fn = tvFocus.slice(tvFocus.indexOf("export function requestNativeFocus"), tvFocus.indexOf("export function requestNativeFocusWithRetry"));
  assert.match(fn, /if \(Platform\.isTV\) \{/);
  // Off that (always-true-in-production) branch, the command is tried again before `.focus()`.
  assert.equal((fn.match(/UIManager\.dispatchViewManagerCommand\(handle, "requestTVFocus" as any, \[\]\);/g) || []).length, 2);
  assert.match(fn, /focus\.call\(node\);/);
  assert.ok(fn.lastIndexOf("dispatchViewManagerCommand") < fn.indexOf("focus.call(node)"));
});
