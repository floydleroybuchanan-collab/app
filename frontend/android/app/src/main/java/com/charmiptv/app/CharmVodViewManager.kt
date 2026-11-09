package com.charmiptv.app

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * RN owns the shared navigation shell. This manager only mounts VOD content.
 * No extra Activity, duplicate icon rail, or independent drawer is created.
 */
class CharmVodViewManager : SimpleViewManager<CharmEmbeddedVodView>() {
    override fun getName(): String = "CharmNativeVod"

    override fun createViewInstance(context: ThemedReactContext): CharmEmbeddedVodView =
        CharmEmbeddedVodView(context)

    @ReactProp(name = "active", defaultBoolean = false)
    fun setActive(view: CharmEmbeddedVodView, active: Boolean) {
        view.setActive(active)
    }

    @ReactProp(name = "drawerOpen", defaultBoolean = false)
    fun setDrawerOpen(view: CharmEmbeddedVodView, drawerOpen: Boolean) {
        view.setDrawerOpen(drawerOpen)
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
        mutableMapOf(
            "topRequestMainDrawer" to mapOf("registrationName" to "onRequestMainDrawer"),
            "topRequestIconRail" to mapOf("registrationName" to "onRequestIconRail"),
            "topPlaybackChanged" to mapOf("registrationName" to "onPlaybackChanged"),
            "topVodError" to mapOf("registrationName" to "onVodError"),
        )

    override fun onDropViewInstance(view: CharmEmbeddedVodView) {
        view.release()
        super.onDropViewInstance(view)
    }
}
