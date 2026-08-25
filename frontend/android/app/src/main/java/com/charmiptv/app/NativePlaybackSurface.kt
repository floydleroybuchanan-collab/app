package com.charmiptv.app

import android.content.Context
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

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

    if (owner != NativePlaybackManager.Owner.NONE) {
      // Owner changes are real lifecycle boundaries, even if Fabric currently
      // has the host off-window. The manager may still have this exact host
      // registered from before the temporary detach.
      NativePlaybackManager.detachSurface(owner, this)
      removeAllViews()
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
    // Do not call NativePlaybackManager.detachSurface() here. Fabric may detach
    // and reattach this same host without dropping it. The PlayerView must stay
    // parented to this host so SurfaceView can recreate its physical Surface and
    // ExoPlayer can continue on the same decoder/session when we reattach.
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
