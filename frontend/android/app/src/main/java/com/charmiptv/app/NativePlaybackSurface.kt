package com.charmiptv.app

import android.content.Context
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * React Native host for the Media3 video output.
 *
 * React/Fabric may temporarily detach and later reattach this native view without
 * changing the `owner` prop. Treat window attachment as the physical video-surface
 * lifetime: bind only while attached, detach while off-window, and perform an
 * explicit final release when React permanently drops the view. The player itself
 * remains owned by NativePlaybackManager, so a surface recycle never creates a
 * second decoder or a second network stream.
 */
class NativePlaybackSurface(context: Context) : FrameLayout(context) {
  private var owner = NativePlaybackManager.Owner.NONE

  init {
    clipChildren = true
    clipToPadding = true
  }

  fun setOwner(value: String?) {
    val next = when (value) {
      "preview" -> NativePlaybackManager.Owner.PREVIEW
      "fullscreen" -> NativePlaybackManager.Owner.FULLSCREEN
      else -> NativePlaybackManager.Owner.NONE
    }
    if (owner == next) return

    if (owner != NativePlaybackManager.Owner.NONE && isAttachedToWindow) {
      NativePlaybackManager.detachSurface(owner, this)
    }
    owner = next
    if (owner != NativePlaybackManager.Owner.NONE && isAttachedToWindow) {
      NativePlaybackManager.attachSurface(owner, this)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (owner != NativePlaybackManager.Owner.NONE) {
      NativePlaybackManager.attachSurface(owner, this)
    }
  }

  override fun onDetachedFromWindow() {
    if (owner != NativePlaybackManager.Owner.NONE) {
      NativePlaybackManager.detachSurface(owner, this)
    }
    super.onDetachedFromWindow()
  }

  fun releaseFromReact() {
    if (owner != NativePlaybackManager.Owner.NONE) {
      NativePlaybackManager.detachSurface(owner, this)
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
