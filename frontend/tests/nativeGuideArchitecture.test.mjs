import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const source = async (path) => (await readFile(join(root, path), "utf8")).replace(/\r\n/g, "\n");

test("Guide is a single native logical canvas with predictive prefetch", async () => {
  const [guide, bridge, view, manager, app] = await Promise.all([
    source("app/(tabs)/guide.tsx"), source("src/components/NativeGuideCanvas.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"),
    source("android/app/src/main/java/com/charmiptv/app/MainApplication.kt"),
  ]);
  assert.match(guide, /<NativeGuideCanvas/);
  assert.doesNotMatch(guide, /TimelineGrid|BoxGrid|focusClaimNonce/);
  assert.match(bridge, /requireNativeComponent<any>\("CharmNativeGuide"\)/);
  assert.match(view, /override fun onDraw\(canvas: Canvas\)/);
  assert.match(view, /override fun onKeyDown/);
  assert.match(view, /moveVelocity/);
  assert.match(view, /combinedGuide\.queryGuideWindow/);
  assert.match(view, /rows\.subList\(from, to\)\.map \{ it\.id \}/);
  assert.match(view, /val ahead = 8 \+ min\(28, moveVelocity \* 2\)/);
  assert.doesNotMatch(view, /val ids = rows\.map \{ it\.id \}/);
  assert.match(manager, /view\.setWindowStart\(value\)/);
  assert.match(manager, /view\.setWindowEnd\(value\)/);
  assert.doesNotMatch(manager, /setTag|getTag|WINDOW_START_TAG|WINDOW_END_TAG/);
  assert.match(manager, /override fun onDropViewInstance/);
  assert.match(manager, /view\.dispose\(\)/);
  assert.match(view, /fun dispose\(\)/);
  assert.doesNotMatch(view, /onDetachedFromWindow\(\)[\s\S]{0,180}(shutdownNow|database\.close)/);
  assert.match(view, /pendingQuery = GuideQuery/);
  assert.match(view, /queryDrainScheduled = AtomicBoolean\(false\)/);
  assert.match(view, /Keep at most one active read plus the newest requested runway/);
  assert.match(app, /add\(NativeGuidePackage\(\)\)/);
});

test("Guide logical resets force a bounded native reload without remounting", async () => {
  const [guide, bridge, manager, view] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/NativeGuideCanvas.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
  ]);
  assert.match(guide, /reloadGeneration=\{resetToken\}/);
  assert.match(bridge, /reloadGeneration\?: number/);
  assert.match(bridge, /reloadGeneration=\{reloadGeneration\}/);
  assert.match(manager, /@ReactProp\(name = "reloadGeneration", defaultInt = 0\)/);
  assert.match(view, /fun setReloadGeneration\(value: Int\)/);
  assert.match(view, /pendingQuery = null[\s\S]{0,260}loadPrograms\(\)/);
  assert.doesNotMatch(guide, /key=\{resetToken\}/);
});

test("native Guide timeline uses real program duration and queries the visible runway", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /visibleWindowMs = 3L \* 60L \* 60_000L/);
  assert.match(view, /private fun timeToX\(timeMs: Long, visibleStartMs: Long, visibleEndMs: Long\)/);
  assert.match(view, /val left = timeToX\(program\.startMs, visibleStartMs, visibleEndMs\)/);
  assert.match(view, /val right = timeToX\(program\.endMs, visibleStartMs, visibleEndMs\)/);
  assert.match(view, /val x = timeToX\(tick, start, end\)/);
  assert.match(view, /val queryStart = max\(windowStartMs, viewportStartMs - horizontalPrefetchBeforeMs\)/);
  assert.match(view, /val queryEnd = min\(windowEndMs, viewportEndMs\(\) \+ horizontalPrefetchAfterMs\)/);
  assert.match(view, /list\.sortedBy \{ it\.startMs \}\.toTypedArray\(\)/);
  assert.doesNotMatch(view, /pixelsPerMinute/);
});

test("native Guide draw loop reuses formatter/date objects instead of allocating per frame", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  // `var`, not `val`: setClock24h() rebuilds this once when the JS-side
  // 24-hour clock preference (Settings > General) changes, not per frame.
  assert.match(view, /private var timeFormatter = SimpleDateFormat\("h:mm a", Locale\.getDefault\(\)\)/);
  assert.match(view, /private val tickDate = Date\(\)/);
  assert.match(view, /fun setClock24h\(value: Boolean\)/);
  const drawHeader = view.match(/private fun drawHeader[\s\S]*?\n  }\n\n  private fun drawClippedText/)?.[0] || "";
  assert.match(drawHeader, /tickDate\.time = tick/);
  assert.match(drawHeader, /timeFormatter\.format\(tickDate\)/);
  assert.doesNotMatch(drawHeader, /SimpleDateFormat\(|Date\(/);
  assert.doesNotMatch(view, /listOfNotNull\(row\.number/);
});

test("native Guide clock24h preference reaches the native time-of-day header", async () => {
  const [guide, bridge, manager, view] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/NativeGuideCanvas.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
  ]);
  assert.match(guide, /clock24h,?\s*\n\s*\} = useStore\(\)/);
  assert.match(guide, /<NativeGuideCanvas[\s\S]*?clock24h=\{clock24h\}/);
  assert.match(bridge, /clock24h=\{clock24h\}/);
  assert.match(manager, /@ReactProp\(name = "clock24h", defaultBoolean = false\) fun clock24h/);
  assert.match(view, /timeFormatter = SimpleDateFormat\(if \(value\) "HH:mm" else "h:mm a", Locale\.getDefault\(\)\)/);
});

test("preview tuning only follows settled native selection", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /if \(settled\) \{[\s\S]{0,130}armPreviewForChannel\(channel\)/);
});

test("Startup V4 uses ordered milestones and exits at eight seconds", async () => {
  const startup = await source("src/components/StartupVersion4.tsx");
  assert.match(startup, /subscribeProgress/);
  assert.match(startup, /const STARTUP_SEQUENCE_MS = 8_000/);
  assert.match(startup, /CACHE_DOT_MS = 900/);
  assert.match(startup, /DATABASE_DOT_MS = 2_400/);
  assert.match(startup, /PLAYLIST_DOT_MS = 4_500/);
  assert.match(startup, /setInterval/);
  assert.match(startup, /return \(\) => clearInterval\(timer\)/);
  assert.match(startup, /const mayEnter = sequenceComplete/);
  assert.match(startup, /Starting EPG in background/);
  assert.match(startup, /let completedForSession = false/);
  assert.match(startup, /if \(mayEnter \|\| completedForSession\)/);
  assert.match(startup, /if \(completedForSession \|\| mayEnter\) return null/);
});

test("settings recovery stays wired and drawer close does not wait for its animation", async () => {
  const [settings, epg, shell] = await Promise.all([
    source("app/(tabs)/settings.tsx"), source("app/(tabs)/epg-sources.tsx"), source("src/components/PurpleTvShell.tsx"),
  ]);
  assert.match(settings, /testID="settings-all-settings"/);
  assert.match(settings, /<PurpleDrawerButton testID="settings-open-drawer" \/>[\s\S]*?testID="settings-all-settings"[\s\S]*?<Ionicons name="arrow-back"/);
  assert.doesNotMatch(settings, /<FocusGuide style=\{styles\.detailsWrap\}>\s*<Pressable[\s\S]*?testID="settings-all-settings"/);
  assert.match(settings, /CharmShowAllSettings/);
  assert.match(epg, />All Settings</);
  assert.doesNotMatch(shell, /openedAtRef|PURPLE_DRAWER_ANIMATION_MS \+ 70/);
  assert.match(shell, /const closeDrawer = useCallback\(\(\) => \{\s*if \(!drawerOpenRef.current\) return;\s*drawerOpenRef.current = false/);
});

test("Settings claims destination focus before swapping tile/detail trees", async () => {
  const settings = await source("app/(tabs)/settings.tsx");
  const choose = settings.match(/const choose = useCallback\([\s\S]*?\n  \}, \[router\]\);/)?.[0] || "";
  assert.match(choose, /setSection\(id\)/);
  const back = settings.match(/useTvBackHandler\([\s\S]*?\n  \);/)?.[0] || "";
  assert.match(back, /setSection\(null\)/);
  assert.match(settings, /useTvRouteEntryFocus\(!section, "settings-tiles"\)/);
  assert.match(settings, /useTvRouteEntryFocus\(!!section, section \|\| "settings-none"\)/);
  assert.match(settings, /hasTVPreferredFocus=\{detailEntryFocus.preferredFocus\}/);
  assert.match(settings, /hasTVPreferredFocus=\{tileEntryFocus.preferredFocus && index === 0\}/);
});

test("native Guide precomputes row labels outside the repaint loop", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /ChannelRow\(val id: String, val name: String, val number: String, val label: String, val displayNumber: String\)/);
  assert.match(view, /drawClippedText\(canvas, row\.label/);
  assert.doesNotMatch(view, /val rowLabel = if \(row\.number\.isBlank\(\)/);
});

test("native Guide treats horizontal cache misses as loading, not false boundaries", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const keys = view.match(/override fun onKeyDown[\s\S]*?override fun onKeyUp/)?.[0] || "";
  assert.doesNotMatch(keys, /current == null \|\| selectedTimeMs <= windowStartMs/);
  assert.match(keys, /selectedTimeMs <= windowStartMs \+ 60_000L/);
  assert.match(keys, /current\?\.let \{ it\.startMs - 1L \} \?: \(selectedTimeMs - 30L \* 60_000L\)/);
  const horizontalLoads = keys.match(/loadPrograms\(\)/g) || [];
  assert.ok(horizontalLoads.length >= 2, "left and right navigation must both refresh the bounded runway");
  assert.match(view, /Keep at most one active read plus the newest requested runway/);
});

test("native Guide renders selectable no-information cells instead of black rows", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  assert.match(view, /var gapStart = visibleStartMs/);
  assert.match(view, /if \(program.startMs > gapStart\) \{\s*drawProgrammeGap\(canvas, gapStart, program.startMs/);
  assert.match(view, /gapStart = max\(gapStart, min\(program.endMs, visibleEndMs\)\)/);
  assert.match(view, /if \(gapStart < visibleEndMs\) \{\s*drawProgrammeGap\(canvas, gapStart, visibleEndMs/);
  assert.match(view, /drawClippedText\(canvas, "No information"/);
  assert.match(view, /val chosen = rowSelected && selectedTimeMs >= start && selectedTimeMs < end/);
  assert.match(view, /while \(start < gapEnd\)[\s\S]*?canvas\.drawLine\(right, top, right, top \+ rowHeight, divider\)[\s\S]*?start = end/);
});

test("held directions cannot repeatedly transfer Guide ownership at a boundary", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const keys = view.match(/override fun onKeyDown[\s\S]*?override fun onKeyUp/)?.[0] || "";
  assert.match(keys, /if \(selectedRow > 0\) moveVertical\(-1\)\s*else if \(overlayMode && event\.repeatCount == 0\) emit\("upBoundary", null\)/);
  assert.match(keys, /if \(channelRailSelected\) \{\s*if \(event\.repeatCount == 0\) emit\("topLeftBoundary", null\)/);
  assert.match(view, /fun setActive\(value: Boolean\)[\s\S]{0,180}isFocusableInTouchMode = value\s*isFocusable = value/);
});

test("native Guide resolves short versus held Select before opening a programme", async () => {
  const view = await source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
  const activity = await source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
  const keys = view.match(/override fun onKeyDown[\s\S]*?private fun moveVertical/)?.[0] || "";
  assert.match(keys, /event\.repeatCount == 0[\s\S]*selectKeyDown = true/);
  assert.match(keys, /event\.repeatCount[\s\S]*selectLongPressSeen = true/);
  assert.match(keys, /val shortPress = selectKeyDown && !selectLongPressSeen/);
  assert.match(keys, /if \(shortPress\) emitSelection\(true, pressed = !channelRailSelected\)/);
  assert.doesNotMatch(keys, /KEYCODE_DPAD_CENTER[^\n]*emitSelection\(true, pressed = true\)/);
  assert.match(activity, /private val selectHoldHandler = Handler\(Looper\.getMainLooper\(\)\)/);
  assert.match(activity, /selectHoldHandler\.postDelayed\([\s\S]{0,160}ViewConfiguration\.getLongPressTimeout\(\)\.toLong\(\)/);
  assert.match(activity, /emitRemoteEvent\("TvRemoteQuickActions", owner\)/);
  assert.match(activity, /if \(wasLong\) return true/);
  assert.match(activity, /if \(owner == null \|\| TvRemoteModule\.remoteContext != owner\) return true/);
  assert.match(activity, /super\.dispatchKeyEvent\(down\)[\s\S]{0,100}super\.dispatchKeyEvent\(up\)/);
  assert.doesNotMatch(activity, /consumedLongSelect/);
});

test("Guide logos are limited to native visible rows and never take input ownership", async () => {
  const [bridge, view, manager, logos, guide] = await Promise.all([
    source("src/components/NativeGuideCanvas.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"),
    source("src/components/ChannelLogo.tsx"), source("app/(tabs)/guide.tsx"),
  ]);
  assert.match(view, /logoCount = .*coerceIn\(0, 32\)/);
  assert.match(view, /lastLogoFirst != firstVisibleRow \|\| ids != lastLogoIds/);
  assert.match(manager, /onLogoViewport/);
  assert.match(bridge, /ids: \(value.ids \|\| \[\]\)\.slice\(0, 32\)/);
  assert.match(bridge, /pointerEvents="none" accessible=\{false\}/);
  assert.match(bridge, /showLogos && !pauseLogos && logoViewport.ids.map/);
  assert.match(guide, /showLogos=\{channelLogos\}\s+pauseLogos=\{!isFocused \|\| surfLogosSuppressed\}/);
  assert.match(logos, /allowDownscaling/);
  assert.match(logos, /cancelQueuedRequest\(\)/);
  assert.match(logos, /maxConcurrentImageLoads = 4/);
  assert.doesNotMatch(view, /BitmapFactory|Glide|ImageDecoder/);
});

test("home continue-watching shelf is outside the horizontal recent-channel scroller", async () => {
  const home = await source("app/(tabs)/index.tsx");
  const ts = await import("typescript");
  const ast = ts.default.createSourceFile("home.tsx", home, ts.default.ScriptTarget.Latest, true, ts.default.ScriptKind.TSX);
  let checked = false;
  function visit(node, horizontalAncestor = false) {
    const isHorizontal = ts.default.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "ScrollView" && node.openingElement.attributes.properties.some(p => p.name?.getText(ast) === "horizontal");
    if (ts.default.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "MediaLibraryShelf") {
      checked = true;
      assert.equal(horizontalAncestor, false);
    }
    ts.default.forEachChild(node, child => visit(child, horizontalAncestor || isHorizontal));
  }
  visit(ast);
  assert.ok(checked);
});

test("guide fit retains readable bounded labels and full accessibility text", async () => {
  const [view, rail] = await Promise.all([source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"), source("src/components/GuidePreviewRail.tsx")]);
  assert.match(view, /TextUtils.ellipsize\(number, numberPaint, 25f \* density/);
  assert.match(view, /contentDescription = if \(program == null\) row.label/);
  assert.match(rail, /maxFontSizeMultiplier=\{1.15\}/);
  assert.match(rail, /accessibilityLabel=\{about\}[^\n]+numberOfLines=\{3\}/);
});
