package com.charmiptv.app

import android.content.Context
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * A React Native layout target for the one authoritative VLC video layout.
 * Mirrors NativePlaybackSurface (Media3): re-attaches on onAttachedToWindow
 * so a detach/reattach that isn't accompanied by an `owner` prop change or a
 * full view teardown (RN view-flattening/recycling, TV window focus churn)
 * can't leave VLCVideoLayout unparented from a mediaPlayer that still thinks
 * it owns this surface — the previous bare-FrameLayout version had no such
 * recovery path and could end up rendering no video.
 */
class NativeVlcPlaybackSurface(context: Context) : FrameLayout(context) {
  private var owner = NativeVlcPlaybackManager.Owner.NONE

  fun setOwner(value: String?) {
    val next = when (value) {
      "fullscreen" -> NativeVlcPlaybackManager.Owner.FULLSCREEN
      else -> NativeVlcPlaybackManager.Owner.PREVIEW
    }
    if (owner == next) return
    if (owner != NativeVlcPlaybackManager.Owner.NONE) NativeVlcPlaybackManager.detachSurface(owner, this)
    owner = next
    NativeVlcPlaybackManager.attachSurface(owner, this)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (owner != NativeVlcPlaybackManager.Owner.NONE) NativeVlcPlaybackManager.attachSurface(owner, this)
  }

  override fun onDetachedFromWindow() {
    if (owner != NativeVlcPlaybackManager.Owner.NONE) NativeVlcPlaybackManager.detachSurface(owner, this)
    super.onDetachedFromWindow()
  }
}

class NativeVlcPlaybackSurfaceManager : SimpleViewManager<NativeVlcPlaybackSurface>() {
  override fun getName(): String = "CharmNativeVlcPlaybackSurface"
  override fun createViewInstance(reactContext: ThemedReactContext): NativeVlcPlaybackSurface = NativeVlcPlaybackSurface(reactContext)

  @ReactProp(name = "owner")
  fun setOwner(view: NativeVlcPlaybackSurface, owner: String?) = view.setOwner(owner)
}
