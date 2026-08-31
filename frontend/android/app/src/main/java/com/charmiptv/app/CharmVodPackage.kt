package com.charmiptv.app

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

    init {
        context.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != REQUEST_VOD) return
                pending?.resolve(null)
                pending = null
            }
        })
    }

    override fun getName() = "CharmVod"

    @ReactMethod
    fun open(promise: Promise) {
        context.runOnUiQueueThread {
            val activity = currentActivity
            if (activity == null || activity.isFinishing) {
                promise.reject("E_VOD_ACTIVITY", "CharmIPTV is not ready to open Video OnDemand.")
                return@runOnUiQueueThread
            }
            if (pending != null) {
                promise.reject("E_VOD_OPEN", "Video OnDemand is already open.")
                return@runOnUiQueueThread
            }
            try {
                pending = promise
                activity.startActivityForResult(Intent(activity, MainTvActivity::class.java), REQUEST_VOD)
            } catch (error: Exception) {
                pending = null
                promise.reject("E_VOD_LAUNCH", "Could not open Video OnDemand.", error)
            }
        }
    }

    override fun invalidate() {
        pending?.reject("E_VOD_CLOSED", "CharmIPTV's screen was recreated.")
        pending = null
        super.invalidate()
    }

    companion object { private const val REQUEST_VOD = 7133 }
}

class CharmVodPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CharmVodModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
