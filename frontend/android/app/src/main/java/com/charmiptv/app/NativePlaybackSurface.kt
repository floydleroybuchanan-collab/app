package com.charmiptv.app

import android.content.Context
import android.view.SurfaceView
import android.widget.FrameLayout
import androidx.media3.ui.PlayerView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import java.lang.ref.WeakReference

/**
 * React Native host for the Media3 video output.
 *
 * The decoder/player belongs to NativePlaybackManager, while this view owns only
 * a render target. React/Fabric is allowed to detach a mounted native view from
 * the window temporarily during layout/navigation work. That must not be treated
 * as destruction: keeping the same PlayerView child lets SurfaceView recreate its
 * physical Surface and reconnect to the same ExoPlayer without inflating another
 * PlayerView, opening another stream, or rebuilding the decoder.
 *
 * A real owner change or onDropViewInstance is different. Those paths explicitly
 * detach the manager and remove the old child so no stale PlayerView/SurfaceView
 * can survive into the next preview/fullscreen owner.
 *
 * Fabric can also create the replacement host before dropping the previous host.
 * Media3 requires the replacement target to be established before the old target
 * is cleared. Doing this in the opposite order can leave a hardware decoder with
 * no usable output Surface during the transition, which is the classic
 * audio-continues/video-black failure. Each owner therefore has one claimed host
 * at a time, and a replacement host is registered first; only after that succeeds
 * is the old PlayerView detached and discarded.
 */
class NativePlaybackSurface(context: Context) : FrameLayout(context) {
  companion object {
    private const val SURFACE_HEALTH_GRACE_MS = 1_000L
    private const val SURFACE_RECHECK_MS = 750L
    private var previewHost: WeakReference<NativePlaybackSurface>? = null
    private var fullscreenHost: WeakReference<NativePlaybackSurface>? = null

    private fun claimedHost(owner: NativePlaybackManager.Owner): NativePlaybackSurface? = when (owner) {
      NativePlaybackManager.Owner.PREVIEW -> previewHost?.get()
      NativePlaybackManager.Owner.FULLSCREEN -> fullscreenHost?.get()
      NativePlaybackManager.Owner.NONE -> null
    }

    private fun rememberHost(owner: NativePlaybackManager.Owner, host: NativePlaybackSurface?) {
      when (owner) {
        NativePlaybackManager.Owner.PREVIEW -> previewHost = host?.let(::WeakReference)
        NativePlaybackManager.Owner.FULLSCREEN -> fullscreenHost = host?.let(::WeakReference)
        NativePlaybackManager.Owner.NONE -> Unit
      }
    }
  }

  private var owner = NativePlaybackManager.Owner.NONE
  private var surfaceRepairAttempted = false

  // Explicit Runnable type required: this lambda posts itself back
  // (postDelayed(surfaceHealthCheck, ...) below), and without an explicit
  // declared type Kotlin's inference can't resolve that self-reference
  // ("Type checking has run into a recursive problem") -- same reason
  // NativePlaybackManager.bufferingWatchdog is annotated the same way.
  private val surfaceHealthCheck: Runnable = Runnable {
    val activeOwner = owner
    if (activeOwner == NativePlaybackManager.Owner.NONE || !isAttachedToWindow) return@Runnable
    val playerView = currentPlayerView() ?: return@Runnable
    if (hasValidPhysicalSurface(playerView)) {
      surfaceRepairAttempted = false
      return@Runnable
    }

    // This is a fallback only. Normal playback must render on the first attach.
    // If Android/Fabric has genuinely left this host with an invalid SurfaceHolder
    // after it has been attached for a full second, rebuild just the render target
    // and keep the same manager/player/session. Do not reopen the stream here.
    if (!surfaceRepairAttempted) {
      surfaceRepairAttempted = true
      NativePlaybackManager.detachSurface(activeOwner, this)
      removeAllViews()
      NativePlaybackManager.attachSurface(activeOwner, this)
      postDelayed(surfaceHealthCheck, SURFACE_RECHECK_MS)
    }
  }

  init {
    clipChildren = true
    clipToPadding = true
  }

  private fun currentPlayerView(): PlayerView? {
    for (index in 0 until childCount) {
      val child = getChildAt(index)
      if (child is PlayerView) return child
    }
    return null
  }

  private fun hasValidPhysicalSurface(playerView: PlayerView): Boolean {
    val renderView = playerView.videoSurfaceView ?: return false
    if (!playerView.isAttachedToWindow || !renderView.isAttachedToWindow) return false
    return when (renderView) {
      is SurfaceView -> try {
        renderView.holder.surface.isValid
      } catch (_: Throwable) {
        false
      }
      else -> renderView.width > 0 && renderView.height > 0
    }
  }

  private fun scheduleSurfaceHealthCheck() {
    removeCallbacks(surfaceHealthCheck)
    if (isAttachedToWindow && owner != NativePlaybackManager.Owner.NONE) {
      postDelayed(surfaceHealthCheck, SURFACE_HEALTH_GRACE_MS)
    }
  }

  private fun retireAfterReplacement(replacedOwner: NativePlaybackManager.Owner) {
    if (owner != replacedOwner) return
    removeCallbacks(surfaceHealthCheck)

    // The replacement host has already been attached to NativePlaybackManager.
    // Detach this old PlayerView only now, matching Media3's required ordering:
    // new target first, old target second. Do not call manager.detachSurface()
    // here because the manager now intentionally points at the replacement host.
    try { currentPlayerView()?.player = null } catch (_: Throwable) {}
    owner = NativePlaybackManager.Owner.NONE
    removeAllViews()
  }

  private fun claimAndAttach() {
    val claimedOwner = owner
    if (claimedOwner == NativePlaybackManager.Owner.NONE) return

    val previous = claimedHost(claimedOwner)
    if (previous !== this) {
      rememberHost(claimedOwner, this)

      // Establish the replacement PlayerView first. NativePlaybackManager will
      // bind the active ExoPlayer to this host if this owner is currently live.
      // Only after that do we retire the previous host below.
      NativePlaybackManager.attachSurface(claimedOwner, this)
      previous?.retireAfterReplacement(claimedOwner)
      scheduleSurfaceHealthCheck()
      return
    }

    // Register immediately, even before this host reaches onAttachedToWindow.
    // PlayerView/SurfaceView can safely exist before the physical Surface does,
    // and Media3 follows Surface lifecycle callbacks. More importantly, prepare()
    // can now see a PlayerView instead of racing Fabric mount and failing the
    // first tune with surface-unavailable / a Retry button.
    NativePlaybackManager.attachSurface(claimedOwner, this)
    scheduleSurfaceHealthCheck()
  }

  private fun releaseClaim(releasedOwner: NativePlaybackManager.Owner) {
    if (claimedHost(releasedOwner) === this) rememberHost(releasedOwner, null)
  }

  fun setOwner(value: String?) {
    val next = when (value) {
      "preview" -> NativePlaybackManager.Owner.PREVIEW
      "fullscreen" -> NativePlaybackManager.Owner.FULLSCREEN
      else -> NativePlaybackManager.Owner.NONE
    }

    if (owner == next) {
      if (owner != NativePlaybackManager.Owner.NONE) claimAndAttach()
      return
    }

    if (owner != NativePlaybackManager.Owner.NONE) {
      val previousOwner = owner
      removeCallbacks(surfaceHealthCheck)
      NativePlaybackManager.detachSurface(previousOwner, this)
      releaseClaim(previousOwner)
      removeAllViews()
    }

    owner = next
    surfaceRepairAttempted = false
    if (owner != NativePlaybackManager.Owner.NONE) claimAndAttach()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    surfaceRepairAttempted = false
    if (owner != NativePlaybackManager.Owner.NONE) claimAndAttach()
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(surfaceHealthCheck)
    // Do not call NativePlaybackManager.detachSurface() here. Fabric may detach
    // and reattach this same host without dropping it. PlayerView owns the
    // SurfaceView lifecycle and will recreate the physical Surface on reattach.
    // A true replacement is handled by claimAndAttach(), and final disposal is
    // handled by releaseFromReact().
    super.onDetachedFromWindow()
  }

  fun releaseFromReact() {
    removeCallbacks(surfaceHealthCheck)
    if (owner != NativePlaybackManager.Owner.NONE) {
      val releasedOwner = owner
      NativePlaybackManager.detachSurface(releasedOwner, this)
      releaseClaim(releasedOwner)
    }
    owner = NativePlaybackManager.Owner.NONE
    removeAllViews()
  }
}

class NativePlaybackSurfaceManager : SimpleViewManager<NativePlaybackSurface>() {
  override fun getName() = "CharmNativePlaybackSurface"

  override fun createViewInstance(context: ThemedReactContext) = NativePlaybackSurface(context)

  @ReactProp(name = "owner")
  fun setOwner(view: NativePlaybackSurface, value: String?) = view.setOwner(value)

  override fun onDropViewInstance(view: NativePlaybackSurface) {
    view.releaseFromReact()
    super.onDropViewInstance(view)
  }
}
