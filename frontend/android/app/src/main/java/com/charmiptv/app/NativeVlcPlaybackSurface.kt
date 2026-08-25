package com.charmiptv.app

import android.content.Context
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * React Native host for the manual LibVLC compatibility engine.
 *
 * It mirrors the Media3 surface lifetime: null/unknown owners mean NONE,
 * temporary Fabric/window detaches release only the physical video target, and
 * final React disposal explicitly clears the host. NativeVlcPlaybackManager
 * remains the sole owner of the decoder/player instance.
 */
class NativeVlcPlaybackSurface(context: Context) : FrameLayout(context) {
  private var owner = NativeVlcPlaybackManager.Owner.NONE

  fun setOwner(value: String?) {
    val next = when (value) {
      "preview" -> NativeVlcPlaybackManager.Owner.PREVIEW
      "fullscreen" -> NativeVlcPlaybackManager.Owner.FULLSCREEN
      else -> NativeVlcPlaybackManager.Owner.NONE
    }
    if (owner == next) return

    if (owner != NativeVlcPlaybackManager.Owner.NONE && isAttachedToWindow) {
      NativeVlcPlaybackManager.detachSurface(owner, this)
    }
    owner = next
    if (owner != NativeVlcPlaybackManager.Owner.NONE && isAttachedToWindow) {
      NativeVlcPlaybackManager.attachSurface(owner, this)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (owner != NativeVlcPlaybackManager.Owner.NONE) {
      NativeVlcPlaybackManager.attachSurface(owner, this)
    }
  }

  override fun onDetachedFromWindow() {
    if (owner != NativeVlcPlaybackManager.Owner.NONE) {
      NativeVlcPlaybackManager.detachSurface(owner, this)
    }
    super.onDetachedFromWindow()
  }

  fun releaseFromReact() {
    if (owner != NativeVlcPlaybackManager.Owner.NONE) {
      NativeVlcPlaybackManager.detachSurface(owner, this)
    }
    owner = NativeVlcPlaybackManager.Owner.NONE
    removeAllViews()
  }
}

class NativeVlcPlaybackSurfaceManager : SimpleViewManager<NativeVlcPlaybackSurface>() {
  override fun getName(): String = "CharmNativeVlcPlaybackSurface"
  override fun createViewInstance(reactContext: ThemedReactContext): NativeVlcPlaybackSurface = NativeVlcPlaybackSurface(reactContext)

  @ReactProp(name = "owner")
  fun setOwner(view: NativeVlcPlaybackSurface, owner: String?) = view.setOwner(owner)

  override fun onDropViewInstance(view: NativeVlcPlaybackSurface) {
    view.releaseFromReact()
    super.onDropViewInstance(view)
  }
}
