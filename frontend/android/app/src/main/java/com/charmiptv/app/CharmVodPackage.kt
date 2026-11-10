package com.charmiptv.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * VOD is a native *view* inside the single Charming MediaLab MainActivity.
 * No secondary Android Activity or process, no extra APK or launcher.
 */
// The embedded VOD surface is registered through RN TV's ReactPackage bridge.
@Suppress("OVERRIDE_DEPRECATION")
class CharmVodPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(CharmVodSurfaceManager(reactContext))
}
