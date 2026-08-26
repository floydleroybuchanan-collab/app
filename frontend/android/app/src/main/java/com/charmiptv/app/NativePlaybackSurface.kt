package com.charmiptv.app

import android.content.Context
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
 * Do not rebuild the PlayerView after a "surface health" timeout. A TextureView
 * that is still 0×0 one second after attach is common during RN layout; detaching
 * it pauses (or used to pause) the decoder and leaves fullscreen black and silent.
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
    clipChildren = false
    clipToPadding = false
  }

  private fun currentPlayerView(): PlayerView? {
    for (index in 0 until childCount) {
      val child = getChildAt(index)
      if (child is PlayerView) return child
    }
    return null
  }

  private fun retireAfterReplacement(replacedOwner: NativePlaybackManager.Owner) {
    if (owner != replacedOwner) return

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
      NativePlaybackManager.attachSurface(claimedOwner, this)
      previous?.retireAfterReplacement(claimedOwner)
      return
    }

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
