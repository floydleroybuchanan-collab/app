import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectStreamKind, media3ContentType } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("opaque HTTP IPTV URLs remain unknown until native Media3 routing", () => {
  const opaque = "http://provider.example/account/token/328923";
  assert.equal(detectStreamKind(opaque, "unknown"), "unknown");
  assert.equal(media3ContentType(detectStreamKind(opaque, "unknown")), "unknown");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/live/abc.m3u8?token=x", null)), "hls");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/live/328923?output=hls", null)), "hls");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/live/328923?output=m3u8", null)), "hls");
  assert.equal(media3ContentType(detectStreamKind("http://provider.example/live/abc.ts?token=x", null)), "transport");
  assert.equal(media3ContentType(detectStreamKind("http://provider.example/live/328923?output=ts", null)), "transport");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/manifest.mpd?token=x", null)), "dash");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/live/328923?output=dash", null)), "dash");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/movie.mp4?token=x", null)), "progressive");
});

test("opaque sniff helper stays bounded even though live startup no longer opens a second GET", async () => {
  const probe = await source("android/app/src/main/java/com/charmiptv/app/NativeOpaqueStreamProbe.kt");
  assert.match(probe, /MAX_SNIFF_BYTES = 4 \* 1024/);
  assert.match(probe, /#EXTM3U/);
  assert.match(probe, /<MPD/);
  assert.match(probe, /looksLikeTransportStream/);
  assert.match(probe, /ftyp|styp|moof/);
  assert.doesNotMatch(probe, /readByteArray\(Long\.MAX_VALUE\)|bytes\(\)/);
});

test("opaque startup uses one Media3 connection, stable confirmation and bounded candidate routing", async () => {
  const [manager, module] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt"),
  ]);
  assert.match(manager, /source\.sourceType != "unknown"/);
  assert.doesNotMatch(manager, /NativeOpaqueStreamProbe\.start/);
  assert.doesNotMatch(manager, /opaqueProbeHttpClient/);
  assert.match(manager, /OPAQUE_PROBE_CACHE_SIZE = 256/);
  assert.match(manager, /OPAQUE_TYPE_PREFS = "charm_media3_stream_types"/);
  assert.match(manager, /OPAQUE_LIVE_CANDIDATES = listOf\("transport", "hls", "dash", "progressive"\)/);
  assert.match(manager, /probeReason = "direct:transport"/);
  assert.match(manager, /startOpaqueCandidate\(instance, source, cacheKey, "transport"/);
  assert.match(manager, /detectedTypeCacheKey\(source\)/);
  assert.match(manager, /"channel:\$it"/);
  assert.match(manager, /getSharedPreferences\(OPAQUE_TYPE_PREFS/);
  assert.match(manager, /main\.postDelayed\(opaqueTypeConfirmation, STABLE_REARM_MS\)/);
  assert.match(manager, /private val opaqueTypeConfirmation = Runnable/);
  assert.match(manager, /confirmSuccessfulStreamType\(\)/);
  assert.match(manager, /tryNextOpaqueCandidate\(created, error\)/);
  assert.match(manager, /isContainerMismatch/);
  assert.match(manager, /forgetDetectedType\(cacheKey\)/);
  assert.doesNotMatch(manager, /if \(firstFrameRendered \|\| !isContainerMismatch\(error\)\)/);
  const firstFrameStart = manager.indexOf("override fun onRenderedFirstFrame()");
  const firstFrameEnd = manager.indexOf("override fun onPlayerError", firstFrameStart);
  const firstFrameBody = manager.slice(firstFrameStart, firstFrameEnd);
  assert.doesNotMatch(firstFrameBody, /confirmSuccessfulStreamType\(\)/);
  assert.doesNotMatch(module, /OpaqueStreamProbe\.probe|NativeOpaqueStreamProbe\.start/);
});

test("known TS/HLS/DASH paths bypass opaque routing and keep the locked playback budgets", async () => {
  const manager = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(manager, /if \(source\.sourceType != "unknown" \|\| !isHttpOrHttps\(source\.uri\)\)/);
  assert.match(manager, /HlsMediaSource\.Factory/);
  assert.match(manager, /ProgressiveMediaSource\.Factory\(dataSource, createLiveTsExtractorsFactory\(\)\)/);
  assert.match(manager, /ConnectionPool\(6, 5, TimeUnit\.MINUTES\)/);
  assert.match(manager, /MIN_BUFFER_MS_LOW_RAM = 10_000/);
  assert.match(manager, /MAX_BUFFER_MS_LOW_RAM = 30_000/);
  assert.match(manager, /PLAYBACK_BUFFER_MS_LOW_RAM = 2_500/);
  assert.match(manager, /REBUFFER_BUFFER_MS_LOW_RAM = 5_000/);
  assert.match(manager, /MIN_BUFFER_MS_NORMAL = 15_000/);
  assert.match(manager, /MAX_BUFFER_MS_NORMAL = 60_000/);
  assert.match(manager, /PLAYBACK_BUFFER_MS_NORMAL = 3_000/);
  assert.match(manager, /REBUFFER_BUFFER_MS_NORMAL = 5_000/);
  assert.match(manager, /readTimeout\(20, TimeUnit\.SECONDS\)/);
  assert.match(manager, /RECOVERY_BACKOFF_MS = longArrayOf\(0L, 1_000L, 3_000L, 6_000L\)/);
});

test("playback diagnostics capture container, codecs, resolution and decoders without changing recovery budgets", async () => {
  const manager = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  assert.match(manager, /created\.addAnalyticsListener/);
  assert.match(manager, /onVideoInputFormatChanged/);
  assert.match(manager, /onAudioInputFormatChanged/);
  assert.match(manager, /onVideoDecoderInitialized/);
  assert.match(manager, /onAudioDecoderInitialized/);
  assert.match(manager, /onVideoSizeChanged/);
  assert.match(manager, /detectedMimeType/);
  assert.match(manager, /videoCodecs/);
  assert.match(manager, /audioCodecs/);
  assert.match(manager, /videoDecoder/);
  assert.match(manager, /audioDecoder/);
  assert.match(manager, /codecError/);
  assert.match(manager, /MIN_BUFFER_MS_LOW_RAM = 10_000/);
  assert.match(manager, /readTimeout\(20, TimeUnit\.SECONDS\)/);
  assert.match(manager, /RECOVERY_BACKOFF_MS = longArrayOf\(0L, 1_000L, 3_000L, 6_000L\)/);
});
