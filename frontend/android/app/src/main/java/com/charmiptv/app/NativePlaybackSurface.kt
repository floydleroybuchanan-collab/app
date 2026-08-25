package com.charmiptv.app

import android.content.Context
import android.widget.FrameLayout
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
 * That overlap is important: if both same-owner hosts retain PlayerViews, the old
 * SurfaceView can recreate its Surface later and steal ExoPlayer's video output
 * back from the visible host. The result is exactly the bad state we must avoid:
 * audio keeps playing while the visible preview/fullscreen surface stays black.
 * Each owner therefore has one claimed host at a time. A replacement host first
 * retires the previous host, then registers itself with NativePlaybackManager.
 */
class NativePlaybackSurface(context: Context) : FrameLayout(context) {
  companion object {
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

  init {
    clipChildren = true
    clipToPadding = true
  }

  private fun claimAndAttach() {
    val claimedOwner = owner
    if (claimedOwner == NativePlaybackManager.Owner.NONE) return

    val previous = claimedHost(claimedOwner)
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
    NativePlaybackManager.attachSurface(claimedOwner, this)
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
      NativePlaybackManager.detachSurface(previousOwner, this)
      releaseClaim(previousOwner)
      removeAllViews()
    }

    owner = next
    if (owner != NativePlaybackManager.Owner.NONE) claimAndAttach()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (owner != NativePlaybackManager.Owner.NONE) claimAndAttach()
  }

  override fun onDetachedFromWindow() {
    // Do not call NativePlaybackManager.detachSurface() here. Fabric may detach
    // and reattach this same host without dropping it. PlayerView owns the
    // SurfaceView lifecycle and will recreate the physical Surface on reattach.
    // A true replacement is handled by claimAndAttach(), and final disposal is
    // handled by releaseFromReact().
    super.onDetachedFromWindow()
  }

  fun releaseFromReact() {
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
