import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("fullscreen guide overlays the existing decoder and BACK returns to that owner", async () => {
  const [player, native, manager, guidePanel] = await Promise.all([
    source("app/player.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeGuidePackage.kt"),
    source("src/components/PlayerGuidePanel.tsx"),
  ]);
  const open = player.slice(player.indexOf("const goGuide ="), player.indexOf("const runRemoteAction ="));
  assert.match(open, /setGuideOverlayOpen\(true\)/);
  assert.doesNotMatch(open, /stopFullscreenSession|stopAllPlaybackSessions|generationRef|router\./);
  assert.match(player, /guideOverlayOpenRef\.current\) \{ setGuideOverlayOpen\(false\); return true; \}/);
  assert.match(player, /<PlayerGuidePanel/);
  assert.match(guidePanel, /<NativeGuideCanvas/);
  assert.match(guidePanel, /overlayMode=\{mode === "overlay"\}/);
  assert.match(player, /style=\{showPlayerGuidePreview \?/);
  assert.equal((player.match(/<StreamPlayer\\b/g) || []).length, 1);
  assert.doesNotMatch(guidePanel, /<StreamPlayer\\b/);
  assert.match(player, /!hasPin \|\| !isGroupLocked\(providerGroupIdentity\(item\.group\)\)/);
  assert.match(player, /void patchProgramsForChannelIds\(ids, priorityIds\)/);
  assert.match(player, /resetRemoteContextIfOwned\("guide", "player"\)/);
  assert.match(manager, /ReactProp\(name = "overlayMode"/);
  const paints = native.slice(native.indexOf("fun setOverlayMode"), native.indexOf("fun setClock24h"));
  assert.match(paints, /background\.alpha = if \(overlayMode\) 0 else 255/);
  assert.match(paints, /rowSurface\.alpha = if \(overlayMode\) 0 else 255/);
  assert.match(paints, /setBackgroundColor\(if \(overlayMode\) Color\.TRANSPARENT/);
  assert.doesNotMatch(paints, /title\.alpha|muted\.alpha/);
});

test("player cleanup cannot clobber a newer TV remote owner", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /resetRemoteContextIfOwned/);
  assert.match(player, /return \(\) => \{\s*resetRemoteContextIfOwned\("player", "default"\);\s*\}/);
  assert.doesNotMatch(player, /return \(\) => resetRemoteContextIfOwned\("player", "default"\)/);
  assert.doesNotMatch(player, /return \(\) => setRemoteContext\("default"\)/);
});

test("Guide blur cleanup cannot clobber a newer TV remote owner", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /resetRemoteContextIfOwned/);
  assert.match(guide, /resetRemoteContextIfOwned\("guide", "default"\)/);
  const focusEffect = guide.match(/useFocusEffect\([\s\S]*?\n\s*\);/)?.[0] || "";
  assert.doesNotMatch(focusEffect, /setRemoteContext\("default"\)/);
});

test("ErrorBoundary crash recovery waits for native decoder release before remount", async () => {
  const player = await source("app/player.tsx");
  const reset = player.match(/onReset=\{\(\) => \{[\s\S]*?\n\s*\}\}/)?.[0] || "";
  assert.match(reset, /void stopAllPlaybackSessions\("crashed"\)\.then\(\(\) => \{/);
  assert.match(reset, /if \(generation === generationRef\.current\) setRetryToken/);
  assert.doesNotMatch(reset, /decoderArmed|DECODER_RESTART_SETTLE_MS|setTimeout/);
});

test("fullscreen exit serializes decoder teardown before Guide remount", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /const exitInFlightRef = useRef\(false\)/);
  assert.match(player, /if \(exitInFlightRef\.current\) return/);
  assert.match(player, /void stopFullscreenSession\(\)\.then\(\(\) => \{[\s\S]*?router\.replace\("\/guide" as any\)/);
});

test("unsupported protocol errors explain the Media3 limitation without offering another identical retry", async () => {
  const player = await source("app/player.tsx");
  assert.match(player, /"unsupported-protocol": "This stream protocol is not supported by this build/);
  assert.match(player, /Ask your provider for an HTTP\(S\) HLS, DASH, or MPEG-TS URL for Media3/);
  assert.match(player, /if \(!hasStream \|\| exitInFlightRef\.current \|\| failReason === "unsupported-protocol"\) return/);
  assert.match(player, /hasStream && failReason !== "unsupported-protocol" \? \(/);
  assert.match(player, /"Unsupported stream protocol"/);
  assert.match(player, /onPress=\{stopAndExit\}/);
});

test("Guide rejects unsupported transports before mounting a native preview or scheduling a retry", async () => {
  const guide = await source("app/(tabs)/guide.tsx");
  assert.match(guide, /isNativeMedia3SupportedStreamKind\(detectStreamKind\(parsePipeHeaders\(channel\.url\)\.uri, channel\.stream_type\)\)/);
  assert.match(guide, /const previewVisible =[\s\S]*?isPreviewProtocolSupported\(tunedChannel\)/);
  assert.match(guide, /testID="guide-preview-unsupported-protocol"/);
  assert.match(guide, /pointerEvents="none" style=\{\[styles\.unsupportedPreview, \{ width: previewLayout\.previewWidth, height: previewLayout\.previewHeight \}\]\}/);
  const schedule = guide.slice(guide.indexOf("const schedulePreview ="), guide.indexOf("const guideTopPanelWidth ="));
  const guard = schedule.indexOf("!isPreviewProtocolSupported(channelById(requestedId))");
  const timer = schedule.indexOf("previewTimer.current = setTimeout");
  assert.ok(guard >= 0 && guard < timer, "reject the current unsupported provider URL before creating a mount timer");
  assert.match(schedule, /!isPreviewProtocolSupported\(channelById\(requestedId\)\)[\s\S]*?setPreviewId\(null\)[\s\S]*?return/);
  const focus = guide.slice(guide.indexOf("const armPreviewForChannel ="), guide.indexOf("const onFocusChannel ="));
  assert.match(focus, /!isPreviewProtocolSupported\(channel\)[\s\S]*?setPreviewId\(null\)[\s\S]*?return/);
});
