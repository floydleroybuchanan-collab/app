import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectStreamKind, media3ContentType } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("opaque HTTP IPTV URLs remain unknown until native response sniffing", () => {
  const opaque = "http://provider.example/account/token/328923";
  assert.equal(detectStreamKind(opaque, "unknown"), "unknown");
  assert.equal(media3ContentType(detectStreamKind(opaque, "unknown")), "unknown");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/live/abc.m3u8?token=x", null)), "hls");
  assert.equal(media3ContentType(detectStreamKind("http://provider.example/live/abc.ts?token=x", null)), "transport");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/manifest.mpd?token=x", null)), "dash");
  assert.equal(media3ContentType(detectStreamKind("https://provider.example/movie.mp4?token=x", null)), "progressive");
});

test("native opaque probe is bounded, redirect-aware and signature-aware", async () => {
  const probe = await source("android/app/src/main/java/com/charmiptv/app/NativeOpaqueStreamProbe.kt");
  assert.match(probe, /MAX_SNIFF_BYTES = 4 \* 1024/);
  assert.match(probe, /safeResponse\.request\.url\.toString\(\)/);
  assert.match(probe, /#EXTM3U/);
  assert.match(probe, /<MPD/);
  assert.match(probe, /looksLikeTransportStream/);
  assert.match(probe, /ftyp|styp|moof/);
  assert.doesNotMatch(probe, /readByteArray\(Long\.MAX_VALUE\)|bytes\(\)/);
});

test("opaque probing is one native path with a bounded session cache", async () => {
  const [manager, module] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt"),
  ]);
  assert.match(manager, /source\.sourceType != "unknown"/);
  assert.match(manager, /NativeOpaqueStreamProbe\.start/);
  assert.match(manager, /OPAQUE_PROBE_CACHE_SIZE = 256/);
  assert.match(manager, /detectedTypeCache\[cacheKey\]/);
  assert.match(manager, /opaqueProbeCall\?\.cancel\(\)/);
  assert.doesNotMatch(module, /OpaqueStreamProbe\.probe|NativeOpaqueStreamProbe\.start/);
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
