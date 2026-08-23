import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePipeHeaders } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("provider headers are preserved without a universal fake user agent", () => {
  assert.deepEqual(parsePipeHeaders("https://provider.example/live"), { uri: "https://provider.example/live", headers: {} });
  const parsed = parsePipeHeaders("https://provider.example/live|User-Agent=Provider%20Box&Referer=https%3A%2F%2Fprovider.example&Authorization=Bearer%20abc");
  assert.equal(parsed.headers["User-Agent"], "Provider Box");
  assert.equal(parsed.headers.Referer, "https://provider.example");
  assert.equal(parsed.headers.Authorization, "Bearer abc");
});

test("native recovery escalates through a real playlist-only source refresh and full player rebuild without changing tuning", async () => {
  const [native, bridge, adapter, memory] = await Promise.all([
    source("android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt"),
    source("src/nativePlayback.ts"),
    source("src/components/StreamPlayer.tsx"),
    source("android/app/src/main/java/com/charmiptv/app/CharmMemoryCoordinator.kt"),
  ]);
  assert.match(native, /MIN_BUFFER_MS_LOW_RAM = 10_000/);
  assert.match(native, /RECOVERY_BACKOFF_MS = longArrayOf\(0L, 1_000L, 3_000L, 6_000L\)/);
  assert.match(native, /when \(recoveryAttempts\)[\s\S]*?1 -> \{ instance\.prepare\(\)/);
  assert.match(native, /2 -> \{[\s\S]*?rebuildMediaSource\(instance, source, "media-source-rebuild"\)/);
  assert.match(native, /3 -> requestFreshSource\(instance, source\)/);
  assert.match(native, /4 -> fullPlayerAndSourceRecovery\(instance, source\)/);
  assert.match(native, /forceFreshSource && recoveryAttempts < 2/);
  assert.match(native, /skipBarePrepare && recoveryAttempts < 1/);
  assert.match(native, /isAuthenticationFailure\(error\)/);
  assert.match(native, /Player\.STATE_ENDED -> \{[\s\S]*?recoverOnce\(created, skipBarePrepare = true\)/);
  assert.match(native, /HlsMediaSource\.Factory\(dataSource\)\.createMediaSource\(item\)/);
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
