from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one literal match in {path}, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1))


def sub_once(path: Path, pattern: str, replacement: str, flags: int = 0) -> None:
    text = path.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"Expected one regex match in {path}, found {count}: {pattern[:140]!r}")
    path.write_text(updated)


mgr = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt")
text = mgr.read_text()
if "private var boundPlayerView: PlayerView? = null" in text:
    raise SystemExit("Surface target ownership fix is already present; refusing to apply twice")

replace_once(
    mgr,
    "  private var previewPlayerView: PlayerView? = null\n  private var fullscreenPlayerView: PlayerView? = null\n  private var player: ExoPlayer? = null",
    "  private var previewPlayerView: PlayerView? = null\n  private var fullscreenPlayerView: PlayerView? = null\n  // The singleton ExoPlayer must have exactly one active PlayerView target.\n  // Preview/fullscreen hosts can overlap briefly under Fabric, so host ownership\n  // and actual Media3 video-target ownership are tracked separately.\n  private var boundPlayerView: PlayerView? = null\n  private var player: ExoPlayer? = null",
)

sub_once(
    mgr,
    r"  fun attachSurface\(surfaceOwner: Owner, surface: FrameLayout\) = runOnMain \{.*?\n  fun setResizeMode",
    '''  fun attachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface = surface
      Owner.FULLSCREEN -> fullscreenSurface = surface
      Owner.NONE -> return@runOnMain
    }
    val video = ensurePlayerViewIn(surfaceOwner, surface)
    if (owner == surfaceOwner) {
      val instance = player
      if (instance == null) {
        video.visibility = View.GONE
      } else {
        bindPlayerView(instance, video, "surface-attached")
        if (activeSource != null) instance.playWhenReady = true
      }
    }
  }
  fun detachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    val attached = when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    }
    // A stale host is never allowed to pause or detach the replacement host.
    if (attached !== surface) return@runOnMain
    val video = playerViewFor(surfaceOwner)
    val instance = player
    if (owner == surfaceOwner && instance != null) {
      instance.playWhenReady = false
      unbindPlayerView(instance, video)
      recordDiagnostic("surface-detached", lastPlaybackError, instance)
      publishState("loading", "surface-detached")
    } else {
      unbindPlayerView(instance, video)
    }
    when (surfaceOwner) {
      Owner.PREVIEW -> { previewSurface = null; previewPlayerView = null }
      Owner.FULLSCREEN -> { fullscreenSurface = null; fullscreenPlayerView = null }
      Owner.NONE -> Unit
    }
  }
  fun setResizeMode''',
    re.S,
)

sub_once(
    mgr,
    r"    val previousOwner = owner\n    owner = requestedOwner\n    if \(previousOwner != Owner\.NONE && previousOwner != requestedOwner\) \{\n      playerViewFor\(previousOwner\)\?\.let \{ it\.player = null; it\.visibility = View\.GONE \}\n    \}",
    "    owner = requestedOwner",
)

replace_once(
    mgr,
    '''    val video = playerViewFor(requestedOwner)
    if (video == null) { finishWithError("surface-unavailable", instance); return@runOnMain }
    video.player = instance
    video.visibility = View.VISIBLE
    publishState("loading", null)''',
    '''    val video = playerViewFor(requestedOwner)
    if (video == null) { finishWithError("surface-unavailable", instance); return@runOnMain }
    if (!bindPlayerView(instance, video, "channel-start")) {
      finishWithError("surface-unavailable", instance)
      return@runOnMain
    }
    publishState("loading", null)''',
)

sub_once(
    mgr,
    r"  private fun stopInternal\(releasePlayer: Boolean\) \{.*?\n  \}\n\n  private fun ensurePlayer",
    '''  private fun stopInternal(releasePlayer: Boolean) {
    cancelRecoveryCallbacks()
    val instance = player
    val video = playerViewFor(owner)
    try { instance?.stop() } catch (_: Throwable) {}
    try { instance?.clearMediaItems() } catch (_: Throwable) {}

    // Reusing ExoPlayer is fine; reusing its old video target is not. Preview
    // must relinquish the PlayerView even when releasePlayer=false, otherwise a
    // later fullscreen/preview tune can leave two PlayerViews competing for one
    // decoder output and produce audio with a black visible surface.
    unbindPlayerView(instance, video)

    owner = Owner.NONE; activeSource = null; lastPlaybackError = null; firstFrameRendered = false; recoveryAttempts = 0; stableSinceMs = 0L
    resetBufferingWatchdogState()
    resetMediaDiagnostics()
    resetOpaqueRoutingState()
    CharmMemoryCoordinator.setPlaybackStarting(false)
    if (releasePlayer) {
      try { instance?.release() } catch (_: Throwable) {}
      player = null
    }
  }

  private fun ensurePlayer''',
    re.S,
)

sub_once(
    mgr,
    r"  private fun playerViewFor\(target: Owner\): PlayerView\? = when \(target\) \{.*?\n  private fun ensurePlayerViewIn",
    '''  private fun playerViewFor(target: Owner): PlayerView? = when (target) {
    Owner.PREVIEW -> previewPlayerView
    Owner.FULLSCREEN -> fullscreenPlayerView
    Owner.NONE -> null
  }

  private fun bindPlayerView(instance: ExoPlayer, video: PlayerView, event: String): Boolean {
    if (player !== instance) return false
    val previous = boundPlayerView
    return try {
      if (previous !== video) {
        // Media3 recommends switchTargetView when moving one Player between
        // PlayerViews. It attaches the new target before detaching the old one.
        PlayerView.switchTargetView(instance, previous, video)
        previous?.visibility = View.GONE
        boundPlayerView = video
        recordDiagnostic("surface-target-switched:$event", lastPlaybackError, instance)
      } else if (video.player !== instance) {
        video.player = instance
        boundPlayerView = video
        recordDiagnostic("surface-target-restored:$event", lastPlaybackError, instance)
      }
      video.visibility = View.VISIBLE
      true
    } catch (failure: Throwable) {
      Log.w(TAG, "surface target bind failed: $event", failure)
      false
    }
  }

  private fun unbindPlayerView(instance: ExoPlayer?, video: PlayerView?) {
    if (video == null) return
    try {
      if (instance != null && boundPlayerView === video) {
        PlayerView.switchTargetView(instance, video, null)
      } else if (video.player != null) {
        video.player = null
      }
    } catch (_: Throwable) {
      try { video.player = null } catch (_: Throwable) {}
    }
    if (boundPlayerView === video) boundPlayerView = null
    video.visibility = View.GONE
  }

  private fun ensureActiveSurfaceBound(instance: ExoPlayer, event: String): Boolean {
    val activeOwner = owner
    if (activeOwner == Owner.NONE || player !== instance) return false
    val target = when (activeOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    } ?: return false
    val video = ensurePlayerViewIn(activeOwner, target)
    if (boundPlayerView === video && video.player === instance && video.visibility == View.VISIBLE) return false
    val rebound = bindPlayerView(instance, video, "surface-rebind:$event")
    if (rebound && activeSource != null) instance.playWhenReady = true
    return rebound
  }

  private fun ensurePlayerViewIn''',
    re.S,
)

replace_once(
    mgr,
    '''    val video = playerViewFor(owner) ?: throw IllegalStateException("Playback surface is unavailable")
    try { video.player = null } catch (_: Throwable) {}
    try { instance.release() } catch (_: Throwable) {}
    player = null
    firstFrameRendered = false
    resetBufferingWatchdogState()
    val rebuilt = ensurePlayer()
    video.player = rebuilt
    rebuildMediaSource(rebuilt, source, "full-player-source-recovery")''',
    '''    val video = playerViewFor(owner) ?: throw IllegalStateException("Playback surface is unavailable")
    unbindPlayerView(instance, video)
    try { instance.release() } catch (_: Throwable) {}
    player = null
    firstFrameRendered = false
    resetBufferingWatchdogState()
    val rebuilt = ensurePlayer()
    if (!bindPlayerView(rebuilt, video, "full-player-source-recovery")) {
      throw IllegalStateException("Playback surface could not be rebound")
    }
    rebuildMediaSource(rebuilt, source, "full-player-source-recovery")''',
)

replace_once(
    mgr,
    '''          try { playerViewFor(owner)?.player = null } catch (_: Throwable) {}
          try { instance.release() } catch (_: Throwable) {}
          player = null''',
    '''          unbindPlayerView(instance, playerViewFor(owner))
          try { instance.release() } catch (_: Throwable) {}
          player = null''',
)

replace_once(
    mgr,
    "    previewPlayerView = null; fullscreenPlayerView = null\n",
    "    previewPlayerView = null; fullscreenPlayerView = null; boundPlayerView = null\n",
)

final = mgr.read_text()
required = [
    "private var boundPlayerView: PlayerView? = null",
    "PlayerView.switchTargetView(instance, previous, video)",
    "unbindPlayerView(instance, video)",
    'bindPlayerView(instance, video, "channel-start")',
    "surface-target-switched:$event",
]
for token in required:
    if token not in final:
        raise SystemExit(f"Missing expected surface ownership token: {token}")

# Preserve whichever jitter profile is currently live on the target branch.
for token in ["HUNG_BUFFER_REPREPARE_MS", "HARD_STALL_RECOVERY_MS", "READ" if False else "readTimeout"]:
    if token not in final:
        raise SystemExit(f"Unexpected playback manager shape after patch: missing {token}")

print("Media3 one-target ownership patch applied; live timeout/buffer values preserved")
