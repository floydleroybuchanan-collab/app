package com.charmiptv.app

import android.content.Context
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * React Native host for the manual LibVLC compatibility engine.
 *
 * Match Media3's lifetime: register the host as soon as the owner prop is set,
 * even before onAttachedToWindow. Fabric may detach/reattach this view during
 * an engine switch; that must not be treated as destruction or LibVLC is left
 * with no layout (black + silent) or is torn down mid-decode (native crash).
 */
class NativeVlcPlaybackSurface(context: Context) : FrameLayout(context) {
  private var owner = NativeVlcPlaybackManager.Owner.NONE

  init {
    clipChildren = false
    clipToPadding = false
  }

  fun setOwner(value: String?) {
    val next = when (value) {
      "preview" -> NativeVlcPlaybackManager.Owner.PREVIEW
      "fullscreen" -> NativeVlcPlaybackManager.Owner.FULLSCREEN
      else -> NativeVlcPlaybackManager.Owner.NONE
    }
    if (owner == next) {
      if (owner != NativeVlcPlaybackManager.Owner.NONE) {
        NativeVlcPlaybackManager.attachSurface(owner, this)
      }
      return
    }

    if (owner != NativeVlcPlaybackManager.Owner.NONE) {
      NativeVlcPlaybackManager.detachSurface(owner, this)
      removeAllViews()
    }
    owner = next
    if (owner != NativeVlcPlaybackManager.Owner.NONE) {
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
    // Do not call detachSurface() here. Fabric may detach and reattach this
    // same host during Settings engine switches and layout. VLCVideoLayout
    // owns the TextureView lifecycle; final disposal is releaseFromReact().
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
