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

test("StreamPlayer ignores progressive confirms on extensionless live URLs", async () => {
  const player = await source("src/components/StreamPlayer.tsx");
  assert.match(player, /confirmedType === "progressive"/);
  assert.match(player, /detectStreamKind\(uri, null\)/);
  assert.match(player, /uriKind === "unknown"/);
});

test("opaque startup has no second-GET probe helper", async () => {
  await assert.rejects(
    source("android/app/src/main/java/com/charmiptv/app/NativeOpaqueStreamProbe.kt"),
    (error) => error?.code === "ENOENT",
  );
});

test("pending native surface preparation has a deadline and participates in ownership cleanup", async () => {
  const native = await source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt");
  const timeout = native.slice(native.indexOf("private val startupTimeout"), native.indexOf("private val delayedRecovery"));
  assert.match(timeout, /pendingPrepare != null[\s\S]*?pendingPrepare = null[\s\S]*?finishWithError\("start-timeout"\)/);
  assert.doesNotMatch(timeout, /armStartupTimeout\(\)/);
  assert.match(native, /fun currentOwner\(\): Owner = pendingPrepare\?\.requestedOwner \?: owner/);
  assert.match(native, /if \(owner == Owner.NONE && pendingPrepare == null\) return/);
  const advance = native.slice(native.indexOf("private fun advanceOpaqueCandidate("), native.indexOf("private fun buildOpaqueAttempts"));
  assert.doesNotMatch(advance, /recoveryAttempts = 0/);
});

test("opaque startup uses one Media3 connection, stable confirmation and bounded candidate routing", async () => {
  const [manager, module, urls] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CharmStreamUrls.kt"),
  ]);
  assert.match(manager, /source\.sourceType != "unknown"/);
  assert.doesNotMatch(manager, /NativeOpaqueStreamProbe\.start/);
  assert.doesNotMatch(manager, /opaqueProbeHttpClient/);
  assert.match(manager, /OPAQUE_PROBE_CACHE_SIZE = 256/);
  assert.match(manager, /OPAQUE_TYPE_PREFS = "charm_media3_stream_types"/);
  assert.match(manager, /OPAQUE_LIVE_CANDIDATES = listOf\("progressive", "hls", "dash"\)/);
  assert.match(manager, /OPAQUE_FIRST_CANDIDATE_TIMEOUT_MS = 12_000L/);
  assert.match(manager, /probeReason = "direct:\$firstType"/);
  assert.match(manager, /startOpaqueCandidate\(instance, source, cacheKey, firstType/);
  assert.match(manager, /detectedTypeCacheKey\(source\)/);
  assert.match(manager, /"channel:\$it"/);
  assert.match(manager, /getSharedPreferences\(OPAQUE_TYPE_PREFS/);
  assert.match(manager, /main\.postDelayed\(opaqueTypeConfirmation, OPAQUE_CONFIRM_MS\)/);
  assert.match(manager, /private val opaqueTypeConfirmation = Runnable/);
  assert.match(manager, /confirmSuccessfulStreamType\(\)/);
  assert.match(manager, /tryNextOpaqueCandidate\(created, error\)/);
  assert.match(manager, /advanceOpaqueCandidateOnStall\(instance, "start-timeout"\)/);
  assert.match(manager, /isContainerMismatch/);
  assert.match(manager, /forgetDetectedType\(cacheKey\)/);
  assert.match(manager, /DEFAULT_STREAM_USER_AGENT = "TiviMate\/5\.1\.6 \(Linux; Android TV\)"/);
  assert.match(manager, /properties\["User-Agent"\] = DEFAULT_STREAM_USER_AGENT/);
  assert.match(manager, /properties\["Accept"\] = "\*\/\*"/);
  assert.match(manager, /CharmHttpClients\.mediaClient\(\)/);
  assert.doesNotMatch(manager, /silentAudioCheck|bufferingWatchdog|RECONNECT_STALL_MS/);
  assert.match(manager, /awaiting-surface/);
  assert.match(manager, /pendingPrepare/);
  assert.match(manager, /cachedType != null && isPersistableDetectedType\(cachedType\)/);
  assert.match(manager, /isOpaqueHttpUri\(source\.uri\)/);
  assert.match(manager, /buildOpaqueAttempts/);
  assert.doesNotMatch(manager, /opaqueUriVariants|CharmStreamUrls\.opaqueUriVariants/);
  assert.doesNotMatch(urls, /opaqueUriVariants|\.ts", "\.m3u8", "\.mp4"/);
  assert.match(manager, /OpaqueAttempt\(source\.uri, type\)/);
  assert.match(manager, /hint == "progressive" && !opaque/);
  assert.match(manager, /"progressive" -> \{/);
  assert.match(manager, /opaqueRouteCacheKey != null \|\| isOpaqueHttpUri\(source\.uri\)/);
  assert.doesNotMatch(manager, /if \(firstFrameRendered \|\| !isContainerMismatch\(error\)\)/);
  const firstFrameStart = manager.indexOf("override fun onRenderedFirstFrame()");
  const firstFrameEnd = manager.indexOf("override fun onPlayerError", firstFrameStart);
  const firstFrameBody = manager.slice(firstFrameStart, firstFrameEnd);
  assert.doesNotMatch(firstFrameBody, /confirmSuccessfulStreamType\(\)/);
  assert.doesNotMatch(module, /OpaqueStreamProbe\.probe|NativeOpaqueStreamProbe\.start/);
  assert.match(module, /onHostResume\(\)/);
  assert.match(module, /NativePlaybackManager\.resume\(\)/);
});

test("known TS/HLS/DASH paths bypass opaque routing and keep the locked playback budgets", async () => {
  const [manager, clients] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CharmHttpClients.kt"),
  ]);
  assert.match(manager, /if \(!opaqueUri && \(source\.sourceType != "unknown" \|\| !isHttpOrHttps\(source\.uri\)\)\)/);
  assert.match(manager, /HlsMediaSource\.Factory/);
  assert.match(manager, /ProgressiveMediaSource\.Factory\(dataSource, createLiveTsExtractorsFactory\(\)\)/);
  assert.match(clients, /ConnectionPool\(6, 5, TimeUnit\.MINUTES\)/);
  assert.match(manager, /fun tivimateBufferDurationsMs/);
  assert.match(manager, /else -> intArrayOf\(10_000, 30_000, 1_500, 3_000\)/);
  assert.match(manager, /CharmHttpClients\.mediaClient\(\)/);
  assert.match(clients, /readTimeout\(20, TimeUnit.SECONDS\)/);
  assert.match(manager, /MAX_ERROR_RECOVERIES = 1/);
  assert.doesNotMatch(manager, /RECONNECT_STALL_MS|RECOVERY_BACKOFF_MS|MAX_AUTO_RECOVERIES/);
  assert.match(manager, /OPAQUE_FIRST_CANDIDATE_TIMEOUT_MS = 12_000L/);
});

test("playback diagnostics capture container, codecs, resolution and decoders without changing recovery budgets", async () => {
  const [manager, clients] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/CharmHttpClients.kt"),
  ]);
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
  assert.doesNotMatch(manager, /silentAudioCheck|bufferingWatchdog/);
  assert.match(manager, /fun tivimateBufferDurationsMs/);
  assert.match(clients, /readTimeout\(20, TimeUnit.SECONDS\)/);
  assert.match(manager, /MAX_ERROR_RECOVERIES = 1/);
  assert.doesNotMatch(manager, /RECOVERY_BACKOFF_MS|MAX_AUTO_RECOVERIES|RECONNECT_STALL_MS/);
});
