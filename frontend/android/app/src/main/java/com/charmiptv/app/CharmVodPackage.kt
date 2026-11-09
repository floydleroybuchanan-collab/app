package com.charmiptv.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * VOD is now a native content surface within Charming MediaLab's primary
 * ReactActivity. A second activity/React root would bypass the common rail
 * timeout and create competing navigation and memory owners.
 */
class CharmVodPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        emptyList()

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(CharmVodViewManager())
}
