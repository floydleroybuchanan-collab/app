package com.charmiptv.app

import android.content.Context
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class NativeVlcPlaybackSurface(context: Context) : FrameLayout(context) {
  private var owner = NativeVlcPlaybackManager.Owner.NONE

  init {
    clipChildren = true
    clipToPadding = true
  }

  fun setOwner(value: String?) {
    val next = when (value) {
      "preview" -> NativeVlcPlaybackManager.Owner.PREVIEW
      "fullscreen" -> NativeVlcPlaybackManager.Owner.FULLSCREEN
      else -> NativeVlcPlaybackManager.Owner.NONE
    }
    if (owner == next) return
    if (owner != NativeVlcPlaybackManager.Owner.NONE) NativeVlcPlaybackManager.detachSurface(owner, this)
    owner = next
    if (owner != NativeVlcPlaybackManager.Owner.NONE) NativeVlcPlaybackManager.attachSurface(owner, this)
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
  override fun getName() = "CharmNativeVlcPlaybackSurface"
  override fun createViewInstance(context: ThemedReactContext) = NativeVlcPlaybackSurface(context)

  @ReactProp(name = "owner")
  fun setOwner(view: NativeVlcPlaybackSurface, value: String?) = view.setOwner(value)
}
