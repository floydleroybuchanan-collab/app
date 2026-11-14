package com.charmiptv.app

import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * What kind of device this is and which layout the viewer chose, readable
 * before the first screen is drawn so the app starts in the right layout.
 */
class CharmDeviceModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "CharmDevice"

  private fun prefs() = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  init { CharmUserAgent.current(ctx) }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun profileSync(): WritableMap {
    val packages = ctx.packageManager
    val config = ctx.resources.configuration
    return Arguments.createMap().apply {
      putBoolean("touch", packages.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN))
      putBoolean("leanback", packages.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
        (config.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION)
      putBoolean("keyboard", config.keyboard == Configuration.KEYBOARD_QWERTY)
      putString("mode", prefs().getString(KEY_MODE, MODE_AUTO) ?: MODE_AUTO)
      putString("userAgent", CharmUserAgent.stored(ctx))
    }
  }

  @ReactMethod
  fun setLayoutMode(mode: String) {
    val value = if (mode == MODE_TV || mode == MODE_MOBILE) mode else MODE_AUTO
    prefs().edit().putString(KEY_MODE, value).apply()
  }

  /** The User-Agent chosen in Settings. Blank returns to the app default. */
  @ReactMethod
  fun setUserAgent(value: String) {
    CharmUserAgent.set(ctx, value)
  }

  /** A personal playlist's own User-Agent for downloads from this address. Blank removes it. */
  @ReactMethod
  fun setHostUserAgent(url: String, value: String) {
    CharmUserAgent.setForUrl(url, value)
  }

  private companion object {
    const val PREFS = "charm_device_layout"
    const val KEY_MODE = "mode"
    const val MODE_AUTO = "auto"
    const val MODE_TV = "tv"
    const val MODE_MOBILE = "mobile"
  }
}
