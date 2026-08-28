import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const native = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt", import.meta.url), "utf8");
const bridge = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt", import.meta.url), "utf8");

function functionSource(name) {
  const start = native.search(new RegExp(`^  (?:private )?fun ${name}\\(`, "m"));
  assert.ok(start >= 0, `missing native function ${name}`);
  const rest = native.slice(start + 1);
  const next = rest.search(/^  (?:private )?fun /m);
  return next < 0 ? rest : rest.slice(0, next);
}

test("quarantined native decoder cannot receive playback, track, buffer, or surface controls", () => {
  const controls = [
    ["pause", "player?.pause()"],
    ["resume", "val instance = player"],
    ["setMuted", "player?.volume"],
    ["selectAudio", "val instance = player"],
    ["selectSubtitle", "val instance = player"],
    ["setResizeMode", "fullscreenPlayerView?.resizeMode"],
    ["attachSurface", "ensurePlayerViewIn("],
    ["ensureActiveSurfaceBound", "ensurePlayerViewIn("],
    ["applyAudioAttributes", "instance.setAudioAttributes("],
    ["applyBufferProfile", "val existing = player"],
  ];
  for (const [name, operation] of controls) {
    const body = functionSource(name);
    const guard = body.indexOf("if (decoderReleaseFailure != null) return");
    assert.ok(guard >= 0 && guard < body.indexOf(operation), `${name} must reject a quarantined player before ${operation}`);
  }
});

test("quarantine still permits surface cleanup and stop Promise settlement without repeating decoder operations", () => {
  const detach = functionSource("detachSurface");
  assert.match(detach, /if \(decoderReleaseFailure == null && owner == surfaceOwner && instance != null\)/);
  assert.match(detach, /try \{ video.player = null \} catch/);
  assert.match(detach, /previewSurface = null; previewPlayerView = null/);
  assert.match(detach, /fullscreenSurface = null; fullscreenPlayerView = null/);

  const stop = functionSource("stopInternal");
  assert.match(stop, /if \(decoderReleaseFailure == null\) \{\s*try \{ instance\?\.stop\(\) \}[^]*?try \{ instance\?\.clearMediaItems\(\) \}/);
  assert.match(stop, /owner = if \(decoderReleaseFailure == null\) Owner.NONE else previousOwner/);
  assert.match(stop, /clearAllPlayerViews\(\)/);
  assert.match(functionSource("stop"), /stopInternal\(releasePlayer\); onStopped\?\.invoke\(decoderReleaseFailure\)/);
  assert.match(bridge, /if \(failure != null\) promise.reject\("E_PLAYBACK_RELEASE"/);
});

test("only verified release success clears the retained player reference", () => {
  assert.match(native, /private val decoderReleaseFailure: Throwable\? get\(\) = decoderReleaseGuard.failure/);
  const release = functionSource("releaseDecoder");
  assert.match(release, /playbackRevision \+= 1/);
  assert.ok(release.indexOf("if (!decoderReleaseGuard.release(instance)) return false") < release.indexOf("if (player === instance) player = null"));
  assert.doesNotMatch(release, /decoderReleaseFailure = null|instance\?\.release/);
  assert.match(functionSource("ensurePlayer"), /check\(decoderReleaseFailure == null\)/);
});
