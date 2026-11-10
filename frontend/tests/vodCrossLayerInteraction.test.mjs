import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Dependency/ownership map for a single, embedded, Fabric-backed VOD screen.
// Every assertion spans at least two components to catch fixes that regress
// their callers, navigation, focus, playback or fragment lifecycle contracts.
const read = (name) => readFileSync(new URL("../" + name, import.meta.url), "utf8");
const vod = "android/vod/app/src/main/java/com/streamflixreborn/streamflix/";
const app = "android/app/src/main/java/com/charmiptv/app/";

test("map 1: Expo Tabs -> focused React route -> single native MainActivity registration", () => {
  const tabs = read("app/(tabs)/_layout.tsx");
  const route = read("app/(tabs)/vod.tsx");
  const packageSource = read(app + "CharmVodPackage.kt");
  const application = read(app + "MainApplication.kt");
  const manifest = read("android/vod/app/src/main/embedded/AndroidManifest.xml");
  assert.match(tabs, /<Tabs.Screen name="vod"/);
  assert.match(route, /useIsFocused\(\)/);
  assert.match(route, /screenActive=\{isFocused\}/);
  assert.match(route, /requireNativeComponent[\s\S]*?\("CharmVodSurface"\)/);
  assert.match(packageSource, /getName\(\) = "CharmVodSurface"|CharmVodSurfaceManager\(reactContext\)/);
  assert.match(application, /add\(CharmVodPackage\(\)\)/);
  assert.doesNotMatch(manifest, /android:process=":vod"|MainTvActivity/);
});

test("map 2: first positive RN layout -> persistent Surface -> fragment exact measured layout", () => {
  const route = read("app/(tabs)/vod.tsx");
  const surface = read(app + "CharmVodSurfaceManager.kt");
  assert.match(route, /if \(layout.width > 0 && layout.height > 0\) setLayoutReady\(true\)/);
  assert.doesNotMatch(route, /setLayoutReady\(false\)|setLayoutReady\(\(current\) => current === ready/);
  assert.match(route, /!mountError && layoutReady/);
  assert.match(surface, /if \(!screenActive \|\| !isAttachedToWindow \|\| fragment != null \|\| mountFailureSent\) return/);
  assert.match(surface, /if \(width <= 0 \|\| height <= 0\) return/);
  assert.match(surface, /View.MeasureSpec.makeMeasureSpec\(w, View.MeasureSpec.EXACTLY\)/);
  assert.match(surface, /container.measure\(widthSpec, heightSpec\)/);
  assert.match(surface, /container.layout\(0, 0, w, h\)/);
  assert.match(surface, /fragment\?\.view\?\.let/);
  assert.match(surface, /post \{ layoutEmbeddedFragment\(\) \}/);
});

test("map 3: nested NavHost layout/graph -> visible actual dashboard -> bounded readiness", () => {
  const layout = read("android/vod/app/src/main/res/layout/activity_main_tv.xml");
  const nav = read("android/vod/app/src/main/res/navigation/nav_main_graph_tv.xml");
  const root = read(vod + "charm/VodRootFragment.kt");
  const home = read(vod + "fragments/home/HomeTvFragment.kt");
  assert.match(layout, /android:id="@\+id\/nav_main_fragment"/);
  assert.match(layout, /app:layout_constraintTop_toBottomOf="@id\/vod_glass_actions"/);
  assert.match(nav, /app:startDestination="@id\/home"/);
  assert.match(nav, /android:id="@\+id\/player"/);
  assert.match(root, /childFragmentManager.findFragmentById\(b.navMainFragment.id\)/);
  assert.match(root, /if \(!hostActive\) return@post/);
  assert.match(root, /if \(b.root.width <= 0 \|\| b.root.height <= 0 \|\| !b.root.isShown\) return@post/);
  assert.ok(root.indexOf("if (!hostActive) return@post") < root.indexOf("++readyAttempts <= 45"));
  assert.match(root, /content\?\.findViewById<View>\(R.id.charming_vod_dashboard\)/);
  assert.match(home, /binding\.charmingVodDashboard\.bindFeatured/);
  assert.match(root, /b.navMainFragment.requestLayout\(\)/);
});

test("map 4: native readiness/error events -> JS subscriptions -> owner-safe lifecycle", () => {
  const route = read("app/(tabs)/vod.tsx");
  const bridge = read(app + "CharmVodSurfaceManager.kt");
  const root = read(vod + "charm/VodRootFragment.kt");
  assert.match(bridge, /screen.onRootReady =/);
  assert.match(bridge, /screen.onRootError =/);
  assert.match(bridge, /emit\("CharmVodRootReady"/);
  assert.match(bridge, /emit\("CharmVodMountError"/);
  assert.doesNotMatch(bridge, /showFailure\(|charm_vod_failure|TextView\(/);
  assert.match(root, /immersiveDestinationListener\?\.let \{ controller\.removeOnDestinationChangedListener\(it\) \}/);
  assert.match(root, /immersiveDestinationListener = null/);
  assert.match(route, /DeviceEventEmitter.addListener\("CharmVodRootReady"/);
  assert.match(route, /DeviceEventEmitter.addListener\("CharmVodMountError"/);
  assert.match(route, /back.remove\(\); rail.remove\(\); mode.remove\(\); failure.remove\(\); mounted.remove\(\)/);
  assert.match(bridge, /fun dispose\(\)/);
  assert.match(bridge, /host.detachVodInput\(this\)/);
  assert.match(bridge, /onRootReady = null/);
  assert.match(bridge, /onRootError = null/);
  assert.match(root, /removeOnLayoutChangeListener\(readinessLayoutListener\)/);
  assert.doesNotMatch(root, /onRootReady = null|onRootError = null/);
});

test("map 5: React focus -> native Surface -> MainActivity -> NavHost D-pad owner", () => {
  const route = read("app/(tabs)/vod.tsx");
  const bridge = read(app + "CharmVodSurfaceManager.kt");
  const activity = read(app + "MainActivity.kt");
  const shell = read("src/components/PurpleTvShell.tsx");
  const root = read(vod + "charm/VodRootFragment.kt");
  const focus = read(vod + "charm/VodFocusCoordinator.kt");
  assert.match(route, /screenActive=\{isFocused\}/);
  assert.match(bridge, /@ReactProp\(name = "screenActive", defaultBoolean = false\)/);
  assert.match(bridge, /fragment\?\.setHostActive\(value\)/);
  assert.match(bridge, /screenActive && isAttachedToWindow && fragment\?\.restoreFocusFromRail\(\) == true/);
  assert.match(activity, /container.screenActive && visible\(container\)/);
  assert.match(activity, /vod.restoreNativeFocus\(\)/);
  assert.match(shell, /active !== "\/vod" && !immersiveContent/);
  assert.match(root, /coordinator\?\.setHostActive\(active\)/);
  assert.match(focus, /if \(disposed \|\| !hostActive \|\| restoring/);
  assert.match(focus, /if \(event.action != KeyEvent.ACTION_DOWN \|\| disposed \|\| !hostActive\) return false/);
  assert.match(focus, /if \(disposed \|\| !hostActive \|\| navigation.currentDestination/);
  assert.match(focus, /if \(!active\) cancelPendingRestore\(\)/);
});

test("map 6: tab blur disarms focus before VOD decoder release and saves previous page", () => {
  const root = read(vod + "charm/VodRootFragment.kt");
  const focus = read(vod + "charm/VodFocusCoordinator.kt");
  const player = read(vod + "fragments/player/PlayerTvFragment.kt");
  const nova = read(vod + "vod/NovaPlayback.kt");
  const source = root.slice(root.indexOf("fun setHostActive("), root.indexOf("private var readyCheckPosted"));
  assert.ok(source.indexOf("coordinator?.setHostActive(active)") < source.indexOf("navigation?.navigateUp()"));
  assert.match(source, /if \(!active && changed && navigation\?\.currentDestination\?\.id == R.id.player\)/);
  assert.match(root, /if \(controller.navigateUp\(\)\) return true/);
  assert.match(focus, /fun restoreFocusFromHost\(\): Boolean/);
  assert.match(player, /override fun onDestroyView\(\)/);
  assert.match(player, /releasePlayer\(\)/);
  assert.match(nova, /override fun onStop\(\) \{ started = false; releaseNative\(\)/);
});

test("map 7: React Live TV decoder handoff is asynchronous and cannot gate native first paint", () => {
  const route = read("app/(tabs)/vod.tsx");
  const playback = read("src/core/playbackSession.ts");
  const root = read(vod + "charm/VodRootFragment.kt");
  assert.match(route, /void stopAllPlaybackSessions\("superseded"\)\.catch/);
  assert.doesNotMatch(route, /await stopAllPlaybackSessions/);
  assert.match(playback, /await stopPreviewSession\(reason\);\s*await stopFullscreenSession\(reason\);/);
  assert.match(root, /binding\.root|return binding\.root/);
  assert.doesNotMatch(root, /ActivityIndicator|waitForFullscreenRelease/);
});

test("map 8: native Back/Focus traversals remain inside VOD until explicit rail boundary", () => {
  const root = read(vod + "charm/VodRootFragment.kt");
  const focus = read(vod + "charm/VodFocusCoordinator.kt");
  const activity = read(app + "MainActivity.kt");
  assert.match(root, /player\?\.onBackPressed\(\) == true/);
  assert.match(root, /onHostBack\?\.invoke\(\)/);
  // Delete the redundant Fragment Back listener, not merely disable it.
  assert.doesNotMatch(root, /OnBackPressedCallback|nativeBackCallback|onBackPressedDispatcher/);
  assert.match(activity, /override fun onBackPressed\(\)/);
  assert.match(activity, /nativeVodOwnsFocus\(\) && vodBackHandler\?\.invoke\(\) == true/);
  assert.match(activity, /if \(nativeVodOwnsFocus\(\) && vodKeyHandler\?\.invoke\(event\) == true\)/);
  assert.match(focus, /VodFocusMemory\.isWithin\(content, current\)/);
  assert.match(focus, /isFirstActionFocused\(current\)/);
  assert.match(focus, /onHostRailFocus\?\.invoke\(\)/);
  assert.match(activity, /fun focusVodRailFromContent\(\): Boolean/);
  assert.match(activity, /private fun nativeVodOwnsFocus\(\): Boolean/);
});
