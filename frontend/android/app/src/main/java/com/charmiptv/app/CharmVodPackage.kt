package com.charmiptv.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * VOD is a native *view* inside the single Charming MediaLab MainActivity.
 * No startActivityForResult(), no independent :vod process and no extra APK.
 */
class CharmVodPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = emptyList()
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(CharmVodSurfaceManager(context))
}
