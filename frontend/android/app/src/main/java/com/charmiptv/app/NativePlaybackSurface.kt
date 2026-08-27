package com.charmiptv.app

import android.content.Context
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.ui.PlayerView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import java.lang.ref.WeakReference

/**
 * React Native host for the Media3 TextureView.
 *
 * Fabric and react-native-screens default to clipChildren=true and often leave a
 * hardware layer behind after a fade. Either one blanks TextureView while ExoPlayer
 * keeps playing audio. This host unclips its ancestor chain and never treats a
 * temporary window detach as destruction.
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
    setBackgroundColor(Color.TRANSPARENT)
    unclipVideoAncestors(this)
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
    unclipVideoAncestors(this)

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
    unclipVideoAncestors(this)
    if (owner != NativePlaybackManager.Owner.NONE) claimAndAttach()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w <= 0 || h <= 0 || owner == NativePlaybackManager.Owner.NONE) return
    // First real layout after a 0×0 GONE/unmeasured host. Rebind so MediaCodec
    // is not left outputting to a dead TextureView while audio continues.
    if (oldw <= 0 || oldh <= 0) claimAndAttach()
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

internal fun unclipVideoAncestors(start: View) {
  var node: Any? = start
  var hops = 0
  while (node is ViewGroup && hops < 32) {
    node.clipChildren = false
    node.clipToPadding = false
    try { node.clipToOutline = false } catch (_: Throwable) {}
    if (node.alpha >= 0.999f && node.layerType != View.LAYER_TYPE_NONE) {
      try { node.setLayerType(View.LAYER_TYPE_NONE, null) } catch (_: Throwable) {}
    }
    node = node.parent
    hops += 1
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
