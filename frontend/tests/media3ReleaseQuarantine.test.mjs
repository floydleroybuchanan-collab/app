import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const native = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt", import.meta.url), "utf8");
const bridge = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt", import.meta.url), "utf8");
const surface = await readFile(new URL("../android/app/src/main/java/com/charmiptv/app/NativePlaybackSurface.kt", import.meta.url), "utf8");

function functionSource(name, source = native) {
  const start = source.search(new RegExp(`^  (?:private )?fun ${name}\\(`, "m"));
  assert.ok(start >= 0, `missing native function ${name}`);
  const rest = source.slice(start + 1);
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
  assert.match(release, /val playbackThread = if \(decoderReleaseFailure == null\) instance\?\.playbackLooper\?\.thread else null/);
  const guard = release.indexOf("if (!decoderReleaseGuard.release(instance, playbackThread)) return false");
  const discard = release.indexOf("if (player === instance) player = null");
  assert.ok(guard >= 0 && discard > guard, "release failure must return before discarding the player");
  assert.doesNotMatch(release, /decoderReleaseFailure = null|instance\?\.release/);
  assert.match(functionSource("ensurePlayer"), /check\(decoderReleaseFailure == null\)/);
  assert.doesNotMatch(native, /setPlaybackLooper\(|setPlaybackLooperProvider\(/);
});

test("late release acknowledgement discards retired state and can rebuild an already attached target", () => {
  const acknowledge = functionSource("acknowledgeCompletedDecoderRelease");
  const guard = acknowledge.indexOf("if (!decoderReleaseGuard.acknowledgeCompletedRelease()) return");
  assert.ok(guard >= 0);
  for (const reset of ["player = null", "playbackListener = null", "analyticsListener = null", "owner = Owner.NONE", "activeSource = null", "pendingPrepare = null", "cancelRecoveryCallbacks()", "clearAllPlayerViews()"])
    assert.ok(acknowledge.indexOf(reset) > guard, `late acknowledgement must gate ${reset}`);
  assert.doesNotMatch(acknowledge, /\.release\(|\.resume\(|\.play\(|\.prepare\(/);
  for (const name of ["prepare", "attachSurface", "currentOwner", "hasReleaseFailure"])
    assert.match(functionSource(name), /acknowledgeCompletedDecoderRelease\(\)/);

  const prepare = functionSource("prepare");
  assert.match(prepare, /Owner\.PREVIEW -> previewSurface/);
  assert.match(prepare, /Owner\.FULLSCREEN -> fullscreenSurface/);
  assert.match(prepare, /val video = surface\s*\?\.takeIf \{ decoderReleaseFailure == null \}\s*\?\.let \{ ensurePlayerViewIn\(requestedOwner, it\) \}/);
  assert.doesNotMatch(prepare, /playerViewFor\(requestedOwner\)/);
  const ensureView = functionSource("ensurePlayerViewIn");
  assert.match(ensureView, /if \(existing\.parent === target\) \{[^]*?return existing\s*\}/);
  assert.match(ensureView, /target\.addView\(video, fillParent\(\)\)/);
});

test("native host replacement binds the new target before retiring the old listener and children", () => {
  const claim = functionSource("claimAndAttach", surface);
  const attach = claim.indexOf("NativePlaybackManager.attachSurface(claimedOwner, this)");
  const retire = claim.indexOf("previous?.retireAfterReplacement(claimedOwner)");
  assert.ok(attach >= 0 && retire > attach, "replace the video target before unbinding the old PlayerView");

  const retired = functionSource("retireAfterReplacement", surface);
  const unbind = retired.indexOf("currentPlayerView()?.player = null");
  const forgetOwner = retired.indexOf("owner = NativePlaybackManager.Owner.NONE");
  const removeViews = retired.indexOf("removeAllViews()");
  assert.ok(unbind >= 0 && forgetOwner > unbind && removeViews > forgetOwner);
  assert.doesNotMatch(retired, /NativePlaybackManager\.(?:stop|pause|release|detachSurface)\(/);
  const detach = functionSource("detachSurface");
  const obsoleteHost = detach.indexOf("if (attached !== surface) return@runOnMain");
  assert.ok(obsoleteHost >= 0 && obsoleteHost < detach.indexOf("val video = playerViewFor(surfaceOwner)"));
});
