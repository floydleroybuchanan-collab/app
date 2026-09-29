package com.charmiptv.app

import kotlinx.coroutines.*
import android.net.Uri
import android.app.Activity
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
    private var usageToken: String? = null
    private val libraryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun readLibrary(method: String, query: String?, promise: Promise) {
        libraryScope.launch {
            try {
                val result = context.contentResolver.call(Uri.parse("content://${context.packageName}.medialab-library"), method, query, null)
                promise.resolve(result?.getString("items") ?: "[]")
            } catch (error: Exception) { promise.reject("E_LIBRARY", "Your movie and series library is unavailable. Try again.", error) }
        }
    }

    @ReactMethod fun libraryItems(kind: String, promise: Promise) = readLibrary(if (kind == "favorites") "favorites" else "continue", null, promise)
    @ReactMethod fun searchLibrary(query: String, promise: Promise) = readLibrary("search", query.take(200), promise)

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
    fun setUsageSession(token: String?) {
        usageToken = token
        com.streamflixreborn.streamflix.charm.CharmUsageReporter.configure(context.applicationContext as android.app.Application, token, BuildConfig.VERSION_CODE, context.currentActivity)
    }

    @ReactMethod
    fun open(promise: Promise) = openAdaptive("auto", "home", "{}", promise)

    @ReactMethod
    fun openAdaptive(layout: String, section: String, settings: String, promise: Promise) {
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
                pending = promise
                val television = layout == "tv" || (layout != "mobile" && (
                    activity.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK) ||
                    (activity.getSystemService(android.content.Context.UI_MODE_SERVICE) as android.app.UiModeManager).currentModeType == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION))
                val target = if (television) MainTvActivity::class.java else com.streamflixreborn.streamflix.activities.main.MainMobileActivity::class.java
                activity.startActivityForResult(Intent(activity, target)
                    .putExtra("medialab.embedded", true)
                    .putExtra("medialab.section", section)
                    .putExtra("medialab.settings", settings)
                    .putExtra("medialab.token", usageToken)
                    .putExtra("medialab.build", BuildConfig.VERSION_CODE), REQUEST_VOD)
            } catch (error: Exception) {
                pending = null
                promise.reject("E_VOD_LAUNCH", "Could not open Video OnDemand.", error)
            }
        }
    }

    override fun invalidate() {
        pending?.reject("E_VOD_CLOSED", "Charming MediaLab's screen was recreated.")
        pending = null
        libraryScope.cancel()
        super.invalidate()
    }

    companion object { private const val REQUEST_VOD = 7133 }
}

class CharmVodPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CharmVodModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
