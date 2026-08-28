import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAppUiForeground, acceptsQuickActionsContext, overlayRestoreContext } from "../src/core/screenActivity.ts";
import { fingerprintStreamUri, matchesStreamFingerprint } from "../src/core/audioDiagnostics.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = async path => (await readFile(join(root, path), "utf8")).replace(/\r\n/g, "\n");

test("UI activity gates stop background and inactive work without treating an unknown initial state as closed", () => {
  assert.equal(isAppUiForeground("active"), true);
  assert.equal(isAppUiForeground(null), true);
  assert.equal(isAppUiForeground(undefined), true);
  assert.equal(isAppUiForeground("background"), false);
  assert.equal(isAppUiForeground("inactive"), false);
});

test("delayed player and Guide quick-action events cannot open a modal on Favorites or Settings", () => {
  for (const path of ["/favorites", "/settings", "/channels", "/", "/player-settings", null, undefined]) {
    assert.equal(acceptsQuickActionsContext(path, "player"), false);
    assert.equal(acceptsQuickActionsContext(path, "guide"), false);
  }
  assert.equal(acceptsQuickActionsContext("/guide", "guide"), true);
  assert.equal(acceptsQuickActionsContext("/guide/details", "guide"), true);
  assert.equal(acceptsQuickActionsContext("/player", "player"), true);
  assert.equal(acceptsQuickActionsContext("/player", "guide"), false);
  assert.equal(acceptsQuickActionsContext("/guide", "player"), false);
});

test("background modal dismissal preserves the mounted player's remote owner without rearming Guide navigation", () => {
  for (const foreground of [true, false]) {
    assert.equal(overlayRestoreContext("/player", foreground), "player");
    for (const path of ["/favorites", "/settings", "/player-settings", "/", null]) {
      assert.equal(overlayRestoreContext(path, foreground), "default");
    }
  }
  assert.equal(overlayRestoreContext("/guide", true), "guide");
  assert.equal(overlayRestoreContext("/guide", false), "default");
});

test("player actions resolve the currently tuned channel even when diagnostics include a stream-kind prefix", () => {
  const oldChannel = "https://provider.invalid/live/one?token=old";
  const playing = "https://provider.invalid/live/two?token=current|Cookie=provider";
  for (const kind of ["hls", "transport", "dash", "unknown"]) {
    const key = fingerprintStreamUri(playing, kind);
    assert.equal(matchesStreamFingerprint(playing, key), true);
    assert.equal(matchesStreamFingerprint(oldChannel, key), false);
  }
});

test("Guide keeps native activity, preview and its clock gated by foreground ownership", async () => {
  const [guide, foreground] = await Promise.all([source("app/(tabs)/guide.tsx"), source("src/hooks/useAppForeground.ts")]);
  assert.match(guide, /const guideForeground = isFocused && appForeground/);
  assert.match(guide, /active=\{guideForeground &&/);
  assert.match(guide, /open=\{groupDrawerOpen && guideForeground\}/);
  assert.match(guide, /if \(!guideForeground\) return;\s*setNow[\s\S]*?setInterval[\s\S]*?clearInterval/);
  assert.match(guide, /if \(!pending \|\| !guideForegroundRef.current\) return/);
  assert.match(guide, /previewTimer.current = null;\s*if \(!guideForegroundRef.current\) return/);
  assert.match(guide, /cancelAnimationFrame\(previewFocusFrame.current\)/);
  assert.match(foreground, /AppState.addEventListener\("change"/);
  assert.match(foreground, /return \(\) => sub.remove\(\)/);
  assert.doesNotMatch(foreground, /setInterval|setTimeout/);
});

test("Guide lifecycle does not tear down on last-channel callback changes and preserves its runway for resume", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  const lifecycle = guide.slice(guide.indexOf("const runwayLifecycleRef"), guide.indexOf("const favoriteSet"));
  assert.match(lifecycle, /runwayLifecycleRef.current =/);
  assert.match(lifecycle, /lifecycle.patchProgramsForChannelIds\(last.ids, last.priority\)/);
  assert.match(lifecycle, /expandRunwayKeepSet\(orderedFilteredIdsRef.current/);
  assert.match(lifecycle, /runwayLifecycleRef.current.quiesceGuideForTransition\(true, true\)/);
  assert.match(lifecycle, /\}, \[guideForeground\]\)/);
  assert.match(guide, /if \(!preserveRunway\) lastRunwayRef.current =/);
  assert.doesNotMatch(lifecycle, /\}, \[channels|\}, \[.*quiesceGuideForTransition/);
});

test("queued native Guide events cannot re-arm hidden preview, selection or runway loading", async () => {
  const canvas = await source("src/components/NativeGuideCanvas.tsx");
  assert.match(canvas, /activeRef.current = active/);
  assert.match(canvas, /return \(\) => \{ activeRef.current = false; \}/);
  for (const name of ["handleSelectionChange", "handleRunwayChange"]) {
    const handler = canvas.slice(canvas.indexOf(`const ${name}`), canvas.indexOf("const value =", canvas.indexOf(`const ${name}`)));
    assert.match(handler, /if \(!activeRef.current\) return/);
  }
  assert.match(canvas, /if \(activeRef.current\) onLeftBoundary\(\)/);
  assert.match(canvas, /if \(activeRef.current\) onUpBoundary\(\)/);
});

test("non-Guide screens explicitly reclaim D-pad ownership and a closed drawer has no focus trap", async () => {
  const shell = await source("src/components/PurpleTvShell.tsx");
  const entry = shell.slice(shell.indexOf("useFocusEffect(useCallback"), shell.indexOf("const afterDrawerClose"));
  assert.match(entry, /if \(active === "\/guide"\) return/);
  assert.match(entry, /setGuideNavigationActive\(false\)/);
  assert.match(entry, /setRemoteContext\("default"\)/);
  assert.match(shell, /closeDrawer\(\{ force: true \}\); \}, \[closeDrawer, pathname\]/);
  const sidebar = shell.slice(shell.indexOf("<FocusGuide\n          style={styles.sidebar}"), shell.indexOf("<SmallBrand"));
  assert.match(sidebar, /focusable=\{drawerOpen\}/);
  for (const direction of ["Up", "Down", "Left", "Right"]) assert.match(sidebar, new RegExp(`trapFocus${direction}=\\{drawerOpen\\}`));
  assert.match(shell, /cancelAnimationFrame\(navigationFrameRef.current\)/);
  assert.match(shell, /if \(foregroundRef.current && pathnameRef.current === path\) run\(\)/);
  assert.match(shell, /const restore = overlayRestoreContext\(pathnameRef.current, foregroundRef.current\);\s*const restored = resetRemoteContextIfOwned\("main_drawer", restore\)/);
});

test("global Program Details cannot survive route replacement or restore the departed route's input context", async () => {
  const modal = await source("src/components/ProgramModal.tsx");
  assert.match(modal, /const visible = !!activeProgram && appForeground && openPathRef.current === pathname/);
  assert.match(modal, /if \(activeProgram && !visible\) closeProgram\(\)/);
  assert.match(modal, /if \(!activeProgram \|\| !visible\) return null/);
  const cleanup = modal.slice(modal.indexOf("const restore ="), modal.indexOf("// Close on the hardware"));
  assert.match(cleanup, /overlayRestoreContext\(pathnameRef.current, foregroundRef.current\)/);
  assert.doesNotMatch(cleanup, /pathname\?\.startsWith/);
  assert.match(modal, /programSessionRef.current !== selectedProgram/);
  assert.match(modal, /if \(reminderBusyRef.current\) return/);
});

test("Quick Actions close invalidates pending queries and hides stale-route modal content immediately", async () => {
  const overlay = await source("src/components/TvQuickActionsOverlay.tsx");
  const close = overlay.slice(overlay.indexOf("const close ="), overlay.indexOf("const afterPlayerOverlayClose"));
  assert.match(close, /overlayGeneration.current \+= 1/);
  assert.match(close, /queryGeneration.current \+= 1/);
  assert.match(close, /setChannelId\(null\)/);
  assert.match(close, /pathnameRef.current/);
  assert.match(close, /overlayRestoreContext\(pathnameRef.current, foregroundRef.current\)/);
  assert.match(overlay, /if \(!foregroundRef.current \|\| !acceptsQuickActionsContext\(pathnameRef.current, nextContext\)\) return/);
  assert.match(overlay, /queryGeneration.current \+= 1;\s*clearTimeout\(timer\)/);
  assert.match(overlay, /if \(!channel\) \{ close\(\); return; \}/);
  assert.match(overlay, /if \(!open \|\| !channel \|\| !appForeground \|\| openPathRef.current !== pathname\) return null/);
  assert.match(overlay, /matchesStreamFingerprint\(item.url, diagnostics.streamKey\)/);
  assert.match(overlay, /if \(isCurrentOverlay\(generation\)\)/);
});

test("busy Settings and Quick Actions buttons keep native focus while rejecting activation", async () => {
  for (const file of ["app/(tabs)/settings.tsx", "src/components/TvQuickActionsOverlay.tsx"]) {
    const body = await source(file);
    const action = body.slice(body.indexOf("function Action("), body.indexOf("const styles ="));
    assert.match(action, /focusable/);
    assert.match(action, /accessibilityState=\{\{ disabled/);
    assert.match(action, /onPress=\{\(\) => \{ if \(!disabled\) onPress\(\); \}\}/);
    assert.doesNotMatch(action, /\bdisabled=\{disabled\}/);
  }
});

test("Favorites and collection minute clocks stop in the background and hidden tabs unmount", async () => {
  const [favorites, collection, mount] = await Promise.all([
    source("app/(tabs)/favorites.tsx"), source("src/components/PurpleChannelCollection.tsx"), source("src/components/FocusedTabMount.tsx"),
  ]);
  for (const body of [favorites, collection]) {
    assert.match(body, /if \(!isFocused \|\| !appForeground\) return/);
    assert.match(body, /clearInterval\(timer\)/);
  }
  assert.match(mount, /return isFocused \? <>{children}<\/> : null/);
});
