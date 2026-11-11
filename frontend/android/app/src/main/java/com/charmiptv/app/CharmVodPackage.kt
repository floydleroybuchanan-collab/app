package com.charmiptv.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * VOD is a native *view* inside the single Charming MediaLab MainActivity.
 * No secondary Android Activity or process, no extra APK or launcher.
 */
class CharmVodPackage : ReactPackage {
    // Read-only recent-titles lookup for the Live TV screen's VOD row.
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(CharmVodHistoryModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(CharmVodSurfaceManager(context))
}
