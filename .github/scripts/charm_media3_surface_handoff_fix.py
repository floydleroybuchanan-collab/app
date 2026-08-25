from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1))


mgr = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt")
surface = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativePlaybackSurface.kt")

replace_once(
    mgr,
    "import android.view.LayoutInflater\nimport android.view.View\n",
    "import android.view.LayoutInflater\nimport android.view.SurfaceView\nimport android.view.View\n",
)

replace_once(
    mgr,
    "  private var previewPlayerView: PlayerView? = null\n  private var fullscreenPlayerView: PlayerView? = null\n  private var player: ExoPlayer? = null",
    "  private var previewPlayerView: PlayerView? = null\n  private var fullscreenPlayerView: PlayerView? = null\n  // Exactly one PlayerView may target the singleton ExoPlayer at a time. This\n  // is separate from preview/fullscreen host registration because Fabric can\n  // overlap old and replacement native hosts during navigation/remounts.\n  private var boundPlayerView: PlayerView? = null\n  private var player: ExoPlayer? = null",
)

replace_once(
    mgr,
    '''  fun attachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
  when (surfaceOwner) { Owner.PREVIEW -> previewSurface = surface; Owner.FULLSCREEN -> fullscreenSurface = surface; Owner.NONE -> return@runOnMain }
  val video = ensurePlayerViewIn(surfaceOwner, surface)
  if (owner == surfaceOwner) {
    val instance = player
    video.player = instance
    video.visibility = if (instance != null) View.VISIBLE else View.GONE
    if (instance != null && activeSource != null) {
      instance.playWhenReady = true
      recordDiagnostic("surface-attached", lastPlaybackError, instance)
    }
  }
}
fun detachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
  val attached = when (surfaceOwner) { Owner.PREVIEW -> previewSurface; Owner.FULLSCREEN -> fullscreenSurface; Owner.NONE -> null }
  if (attached !== surface) return@runOnMain
  val video = playerViewFor(surfaceOwner)
  val instance = player
  if (owner == surfaceOwner && instance != null) {
    // Pause before unbinding video so audio can never keep running with
    // no output surface. A replacement surface resumes this same player.
    instance.playWhenReady = false
    recordDiagnostic("surface-detached", lastPlaybackError, instance)
    publishState("loading", "surface-detached")
  }
  if (video?.parent === surface) { try { video.player = null } catch (_: Throwable) {} }
  when (surfaceOwner) {
    Owner.PREVIEW -> { previewSurface = null; previewPlayerView = null }
    Owner.FULLSCREEN -> { fullscreenSurface = null; fullscreenPlayerView = null }
    Owner.NONE -> Unit
  }
}''',
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
    // A replacement host may already have been registered. Never let teardown
    // from the old Fabric host pause or clear the newly-selected render target.
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
  }''',
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

replace_once(
    mgr,
    '''    val video = playerViewFor(owner)
    try { instance?.stop() } catch (_: Throwable) {}
    try { instance?.clearMediaItems() } catch (_: Throwable) {}
    owner = Owner.NONE; activeSource = null; lastPlaybackError = null; firstFrameRendered = false; recoveryAttempts = 0; stableSinceMs = 0L
    resetBufferingWatchdogState()
    resetMediaDiagnostics()
    resetOpaqueRoutingState()
    CharmMemoryCoordinator.setPlaybackStarting(false)
    video?.visibility = View.GONE
    if (releasePlayer) {
      try { video?.player = null } catch (_: Throwable) {}
      try { instance?.release() } catch (_: Throwable) {}
      player = null
    }''',
    '''    val video = playerViewFor(owner)
    try { instance?.stop() } catch (_: Throwable) {}
    try { instance?.clearMediaItems() } catch (_: Throwable) {}
    // A stopped preview/fullscreen must relinquish video output even when the
    // ExoPlayer object is intentionally kept for reuse. Leaving video.player
    // assigned here allowed the next owner to create a second competing target.
    unbindPlayerView(instance, video)
    owner = Owner.NONE; activeSource = null; lastPlaybackError = null; firstFrameRendered = false; recoveryAttempts = 0; stableSinceMs = 0L
    resetBufferingWatchdogState()
    resetMediaDiagnostics()
    resetOpaqueRoutingState()
    CharmMemoryCoordinator.setPlaybackStarting(false)
    if (releasePlayer) {
      try { instance?.release() } catch (_: Throwable) {}
      player = null
    }''',
)

replace_once(
    mgr,
    '''  private fun playerViewFor(target: Owner): PlayerView? = when (target) {
  Owner.PREVIEW -> previewPlayerView
  Owner.FULLSCREEN -> fullscreenPlayerView
  Owner.NONE -> null
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
  if (video.player === instance && video.visibility == View.VISIBLE) return false
  return try {
    video.player = instance
    video.visibility = View.VISIBLE
    if (activeSource != null) instance.playWhenReady = true
    recordDiagnostic("surface-rebind:$event", lastPlaybackError, instance)
    true
  } catch (failure: Throwable) {
    Log.w(TAG, "surface rebind failed: $event", failure)
    false
  }
}''',
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
        // Media3 explicitly recommends switchTargetView for one Player moving
        // between PlayerViews. It attaches the new output before detaching the
        // old one, preventing a stale SurfaceView from stealing/clearing video.
        PlayerView.switchTargetView(instance, previous, video)
        previous?.visibility = View.GONE
        boundPlayerView = video
      } else if (video.player !== instance) {
        video.player = instance
        boundPlayerView = video
      }
      video.visibility = View.VISIBLE
      recordDiagnostic("surface-bound:$event", lastPlaybackError, instance)
      true
    } catch (failure: Throwable) {
      Log.w(TAG, "surface bind failed: $event", failure)
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

  private fun physicalSurfaceInvalid(video: PlayerView): Boolean {
    if (!video.isAttachedToWindow) return false
    val surfaceView = video.videoSurfaceView as? SurfaceView ?: return false
    return !surfaceView.holder.surface.isValid
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
    val alreadyBound = boundPlayerView === video && video.player === instance && video.visibility == View.VISIBLE
    if (alreadyBound && !physicalSurfaceInvalid(video)) return false

    // If PlayerView still points at the player but its actual SurfaceHolder is
    // invalid, detach/re-attach only the render target. Do not restart the URL,
    // socket, MediaSource, decoder, or playback position.
    if (alreadyBound) unbindPlayerView(instance, video)
    val rebound = bindPlayerView(instance, video, "surface-rebind:$event")
    if (rebound && activeSource != null) instance.playWhenReady = true
    return rebound
  }''',
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
    '''    listener = null; activity = null; previewSurface = null; fullscreenSurface = null
    previewPlayerView = null; fullscreenPlayerView = null''',
    '''    listener = null; activity = null; previewSurface = null; fullscreenSurface = null
    previewPlayerView = null; fullscreenPlayerView = null; boundPlayerView = null''',
)

replace_once(
    surface,
    '''    val previous = claimedHost(claimedOwner)
    if (previous !== this) {
      if (previous != null) {
        // Retire the old host before binding the replacement. This ordering is
        // deliberate: an old SurfaceView must not be allowed to destroy/clear
        // the newly selected output after the replacement is already active.
        NativePlaybackManager.detachSurface(claimedOwner, previous)
        previous.removeAllViews()
      }
      rememberHost(claimedOwner, this)
    }

    // Register immediately, even before this host reaches onAttachedToWindow.
    // PlayerView/SurfaceView can safely exist before the physical Surface does,
    // and Media3 will follow the Surface lifecycle. More importantly, prepare()
    // can now see a valid PlayerView instead of racing Fabric mount and failing
    // the first tune with surface-unavailable / a Retry button.
    NativePlaybackManager.attachSurface(claimedOwner, this)''',
    '''    val previous = claimedHost(claimedOwner)
    if (previous !== this) rememberHost(claimedOwner, this)

    // Register the replacement first. NativePlaybackManager uses Media3's
    // switchTargetView(), which attaches this new target before detaching the old
    // one. That is the supported seamless handoff order and prevents the old
    // SurfaceView from clearing video after the new host becomes visible.
    NativePlaybackManager.attachSurface(claimedOwner, this)

    if (previous != null && previous !== this) {
      // The manager now points at this host, so detachSurface(previous) is safely
      // ignored as stale; switchTargetView already detached its PlayerView.
      NativePlaybackManager.detachSurface(claimedOwner, previous)
      previous.removeAllViews()
    }''',
)

manager_text = mgr.read_text()
surface_text = surface.read_text()
required = [
    "private var boundPlayerView: PlayerView? = null",
    "PlayerView.switchTargetView(instance, previous, video)",
    "physicalSurfaceInvalid(video)",
    "unbindPlayerView(instance, video)",
    'bindPlayerView(instance, video, "channel-start")',
    "MIN_BUFFER_MS_NORMAL = 15_000",
    "MAX_BUFFER_MS_NORMAL = 45_000",
    "HARD_STALL_RECOVERY_MS = 45_000L",
]
for token in required:
    if token not in manager_text:
        raise SystemExit(f"Missing expected manager token: {token}")
if "NativePlaybackManager.attachSurface(claimedOwner, this)\n\n    if (previous != null && previous !== this)" not in surface_text:
    raise SystemExit("Replacement host is not attached before stale host retirement")

print("Media3 surface handoff patch applied and structurally verified")
