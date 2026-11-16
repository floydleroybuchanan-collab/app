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
  assert.match(player, /const phoneUi = !shouldUseTvLayout\(deviceLayoutMode\)/);
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
  assert.match(read("app/(tabs)/settings.tsx"), /width: phoneUi \? "31\.5%" : "23\.8%"/);
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
  assert.ok(size("scene_loop.webp") > 15_000_000);
  assert.ok(size("startup_move.webp") > 5_000_000);
  // The WebP header carries the canvas size: width-1 and height-1 as 24-bit little-endian at bytes 24 and 27.
  const dims = (f) => { const b = readFileSync(new URL(`../assets/login/${f}`, import.meta.url)).subarray(0, 40); return [(b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1]; };
  assert.deepEqual(dims("scene_loop.webp"), [1920, 1080]);
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

test("the native Guide has genre-coloured glass cells, colourful channel tiles and a clear background on TV and phone", () => {
  const view = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /private fun tintFor\(program: NativeEpgProgram\): Paint/);
  assert.match(view, /private val cellRadius = 12f \* density/);
  assert.match(view, /TILE_COLORS\[\(name\.hashCode\(\) and 0x7fffffff\) % TILE_COLORS\.size\]/);
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
  assert.match(view, /if \(!compact\) drawClippedText\(canvas, row\.label/);
  assert.match(read("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"), /name = "compact"/);
});

test("the player's Quick Actions reach it on a phone (Aspect ratio used to do nothing) and the phone has an Aspect button", () => {
  const player = read("app/player.tsx");
  assert.doesNotMatch(player, /if \(!isTV\) return;\s*return addPlayerQuickCommandListener/);
  assert.match(player, /return addPlayerQuickCommandListener\(\(command\) => \{/);
  assert.match(player, /testID="player-aspect-ratio" onPress=\{cycleScaleMode\}/);
  const vod = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/player/PlayerTvFragment.kt");
  assert.match(vod, /UserPreferences\.PlayerResize\.Fit -> UserPreferences\.PlayerResize\.Fill/);
  assert.match(vod, /UserPreferences\.PlayerResize\.Fill -> UserPreferences\.PlayerResize\.Zoom/);
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
  assert.match(phone, /nav_main_graph_mobile/);
  assert.match(phone, /CrownBackdrop\(requireContext\(\)\)/);
  assert.match(phone, /popUpTo\(R\.id\.providers\)/);
  assert.match(phone, /bnvMain\.visibility = View\.GONE/);
  for (const section of ["Home", "Movies", "TV Shows", "My List", "Search", "Settings"]) assert.ok(phone.includes(`"${section}"`), section);
  const tv = read("android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/VodRootFragment.kt");
  assert.match(tv, /nav_main_graph_tv/);
  assert.doesNotMatch(tv, /nav_main_graph_mobile/);
});
