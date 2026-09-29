package com.charmiptv.app

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import com.streamflixreborn.streamflix.activities.main.MainMobileActivity
import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import com.streamflixreborn.streamflix.activities.main.MainTvActivity

/** One internal screen in this APK; no external package, install, or deep link. */
class CharmVodModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private var pending: Promise? = null

    init {
        context.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != REQUEST_VOD) return
                pending?.resolve(data?.getStringExtra("medialab.route"))
                pending = null
            }
        })
    }

    override fun getName() = "CharmVod"

    @ReactMethod
    fun open(promise: Promise) { openSection("library", "{}", "[]", promise) }

    @ReactMethod
    fun clearSession() { com.streamflixreborn.streamflix.charm.MediaLabSession.clear() }

    @ReactMethod
    fun openSection(section: String, settings: String, destinations: String, promise: Promise) {
        context.runOnUiQueueThread {
            val activity = context.currentActivity
            if (activity == null || activity.isFinishing) {
                promise.reject("E_VOD_ACTIVITY", "Charming MediaLab is not ready to open Video OnDemand.")
                return@runOnUiQueueThread
            }
            if (pending != null) {
                promise.reject("E_VOD_OPEN", "Video OnDemand is already open.")
                return@runOnUiQueueThread
            }
            try {
                com.streamflixreborn.streamflix.charm.MediaLabPlayback.configure(settings)
                com.streamflixreborn.streamflix.charm.MediaLabSession.destinations = org.json.JSONArray(destinations)
                pending = promise
                activity.startActivityForResult(Intent(activity, if (org.json.JSONObject(settings).optString("layout") == "tv" || (org.json.JSONObject(settings).optString("layout") != "mobile" && ((activity.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION || activity.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)))) MainTvActivity::class.java else MainMobileActivity::class.java).putExtra("medialab.section", section), REQUEST_VOD)
            } catch (error: Exception) {
                pending = null
                promise.reject("E_VOD_LAUNCH", "Could not open Video OnDemand.", error)
            }
        }
    }

    override fun invalidate() {
        pending?.reject("E_VOD_CLOSED", "Charming MediaLab's screen was recreated.")
        pending = null
        super.invalidate()
    }

    companion object { private const val REQUEST_VOD = 7133 }
}

class CharmVodPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CharmVodModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
