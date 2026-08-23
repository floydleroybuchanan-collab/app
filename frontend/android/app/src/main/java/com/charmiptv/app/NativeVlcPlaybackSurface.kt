package com.charmiptv.app

import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class NativeVlcPlaybackSurfaceManager : SimpleViewManager<FrameLayout>() {
  override fun getName(): String = "CharmNativeVlcPlaybackSurface"
  override fun createViewInstance(reactContext: ThemedReactContext): FrameLayout = FrameLayout(reactContext)
  @ReactProp(name = "owner")
  fun setOwner(view: FrameLayout, owner: String?) {
    val parsed = if (owner == "fullscreen") NativeVlcPlaybackManager.Owner.FULLSCREEN else NativeVlcPlaybackManager.Owner.PREVIEW
    view.tag = parsed
    NativeVlcPlaybackManager.attachSurface(parsed, view)
  }
  override fun onDropViewInstance(view: FrameLayout) {
    val owner = view.tag as? NativeVlcPlaybackManager.Owner
    if (owner != null) NativeVlcPlaybackManager.detachSurface(owner, view)
    super.onDropViewInstance(view)
  }
}
