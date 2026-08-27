import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePipeHeaders } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("stream requests default to Charm playlist UA when the M3U omits User-Agent", () => {
  assert.deepEqual(parsePipeHeaders("https://provider.example/live"), {
    uri: "https://provider.example/live",
    headers: { "User-Agent": "TiviMate/5.1.6 (Linux; Android TV)" },
  });
  const parsed = parsePipeHeaders("https://provider.example/live|User-Agent=Provider%20Box&Referer=https%3A%2F%2Fprovider.example&Authorization=Bearer%20abc");
  assert.equal(parsed.headers["User-Agent"], "Provider Box");
  assert.equal(parsed.headers.Referer, "https://provider.example");
  assert.equal(parsed.headers.Authorization, "Bearer abc");
});

test("native recovery performs one full rebuild, refreshing only on authentication failure", async () => {
  const [native, bridge, adapter, memory] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("src/nativePlayback.ts"),
    source("src/components/StreamPlayer.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/CharmMemoryCoordinator.kt"),
  ]);
  assert.match(native, /fun tivimateBufferDurationsMs/);
  assert.match(native, /MAX_ERROR_RECOVERIES = 1/);
  assert.match(native, /ERROR_RECOVERY_DELAY_MS = 1_000L/);
  assert.match(native, /if \(forceFreshSource\) \{[\s\S]*?requestFreshSource\(instance, activeSource\)/);
  assert.match(native, /private fun performRecovery[\s\S]*?fullPlayerAndSourceRecovery\(instance, source\)/);
  assert.doesNotMatch(native, /RECOVERY_BACKOFF_MS|MAX_AUTO_RECOVERIES|skipBarePrepare|when \(recoveryAttempts\)/);
  assert.match(native, /isAuthenticationFailure\(error\)/);
  assert.match(native, /Player\.STATE_ENDED -> \{[\s\S]*?recoverOnce\(created, forceFreshSource = false\)/);
  assert.match(native, /HlsMediaSource\.Factory\(dataSource\)[\s\S]*?DefaultHlsExtractorFactory\(liveTsFlags, true\)[\s\S]*?createMediaSource\(item\)/);
  assert.match(native, /DashMediaSource\.Factory\(dataSource\)\.createMediaSource\(item\)/);
  assert.match(native, /setWakeMode\(C\.WAKE_MODE_NETWORK\)/);
  assert.match(native, /trimNonEssentialForPlaybackRecovery\(\)/);
  assert.match(memory, /fun trimNonEssentialForPlaybackRecovery/);
  assert.match(bridge, /NativePlaybackSourceRefreshRequested/);
  assert.match(adapter, /refreshPlaybackChannel\(event\.channelKey\)/);
  assert.match(adapter, /fresh-channel-unavailable-reused-current/);
  assert.match(adapter, /source-refresh-failed[\s\S]*?-reused-current/);
  assert.doesNotMatch(adapter, /if \(!event\.authenticationFailure\)/);
  assert.match(adapter, /resolveNativePlaybackFreshSource/);
});

test("failure diagnostics include Media3, HTTP, buffering, memory and EPG context", async () => {
  const [native, module, bridge] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt"),
    source("src/nativePlayback.ts"),
  ]);
  for (const field of ["media3ErrorCode", "httpResponseCode", "causeChain", "bufferedDurationMs", "contentType", "sourceType", "heapUsedBytes", "heapMaxBytes", "CharmEpgRamDiagnostics.stats()"])
    assert.match(native, new RegExp(field.replace(/[().]/g, "\\$&")));
  assert.match(native, /HttpDataSource\.InvalidResponseCodeException/);
  assert.match(module, /NativePlaybackDiagnostics/);
  assert.match(module, /putMap\("epgRam", epg\)/);
  assert.match(bridge, /addNativePlaybackDiagnosticListener/);
});

test("HTTP defaults are not injected into non-HTTP protocol requests", () => {
  assert.deepEqual(parsePipeHeaders("rtsp://provider.example/live"), { uri: "rtsp://provider.example/live", headers: {} });
  assert.equal(parsePipeHeaders("rtsp://provider.example/live|User-Agent=Provider%20RTSP").headers["User-Agent"], "Provider RTSP");
  assert.deepEqual(parsePipeHeaders("udp://@239.0.0.1:1234").headers, {});
});

test("only the matching session resolves source refresh and fallback retains fresh credentials", async () => {
  const adapter = await source("src/components/StreamPlayer.tsx");
  const handler = adapter.slice(adapter.indexOf("useEffect(() => addNativePlaybackSourceRefreshListener"), adapter.indexOf("useEffect(() => addNativePlaybackTracksListener"));
  const admission = handler.slice(0, handler.indexOf("const current ="));
  assert.match(admission, /event.owner !== owner/);
  assert.match(admission, /event.generation !== generation/);
  assert.match(admission, /event.channelKey !== currentChannelKey/);
  assert.doesNotMatch(admission, /resolveNativePlaybackFreshSource/);
  assert.match(handler, /generationRef.current !== generation/);
  assert.match(handler, /currentSourceRef.current = \{ key: playbackKey, \.\.\.fresh, contentType: freshType \}/);
  assert.match(adapter, /prepareNativeVlcFullscreen\(generation, currentChannelKey, source.uri, source.headers/);
});

test("native release errors reject ownership handoffs and cannot allocate a replacement decoder", async () => {
  const [media3, vlc, media3Bridge, vlcBridge] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativeVlcPlaybackModule.kt"),
  ]);
  assert.match(media3, /check\(decoderReleaseFailure == null\)/);
  assert.match(media3, /check\(releaseDecoder\(instance\)\)/);
  assert.match(vlc, /if \(!releasePlayerOnly\(removeLayout = false\)\)/);
  for (const bridge of [media3Bridge, vlcBridge]) assert.match(bridge, /promise.reject\("E_PLAYBACK_RELEASE"/);
});

test("Media3 RTSP uses the provider user agent on its dedicated transport", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(native, /RtspMediaSource.Factory\(\).setUserAgent\(userAgent\).createMediaSource\(item\)/);
  assert.match(native, /RTSP custom headers are unsupported/);
});
