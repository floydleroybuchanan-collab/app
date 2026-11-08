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
    private var historyAccount: String? = null
    private val libraryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val activityListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != REQUEST_VOD) return
            pending?.resolve(data?.getStringExtra("medialab.route"))
            pending = null
        }
    }

    private fun readLibrary(method: String, query: String?, promise: Promise) {
        val account = historyAccount
        val scope = com.streamflixreborn.streamflix.charm.CharmVodAccountScope.activeScopePrefix()
        if (account == null || scope == null) { promise.resolve("[]"); return }
        libraryScope.launch {
            try {
                val extras = android.os.Bundle().apply { putString("historyPrefix", scope) }
                val result = context.contentResolver.call(Uri.parse("content://${context.packageName}.medialab-library"), method, query, extras)
                promise.resolve(result?.getString("items") ?: "[]")
            } catch (error: Exception) { promise.reject("E_LIBRARY", "Your movie and series library is unavailable. Try again.", error) }
        }
    }

    @ReactMethod
    fun setHistoryAccount(account: String?, promise: Promise) {
        try {
            historyAccount = null
            com.streamflixreborn.streamflix.charm.CharmVodAccountScope.activate(context, account)
            historyAccount = account?.takeIf { it.isNotBlank() }
            promise.resolve(true)
        } catch (failure: Exception) {
            com.streamflixreborn.streamflix.charm.CharmVodAccountScope.activate(context, null)
            promise.reject("VOD_ACCOUNT_SCOPE", "Could not activate private VOD history for this account.", failure)
        }
    }

    @ReactMethod fun libraryItems(kind: String, promise: Promise) = readLibrary(if (kind == "favorites") "favorites" else "continue", null, promise)
    @ReactMethod fun searchLibrary(query: String, promise: Promise) = readLibrary("search", query.take(200), promise)
    @ReactMethod fun configureSurface(settings: String, promise: Promise) {
        context.runOnUiQueueThread {
            // JS cleanup intentionally tolerates release errors. VOD must not
            // acquire a second decoder when native ownership is still uncertain.
            if (NativePlaybackManager.hasReleaseFailure() || NativeMultiview.active || NativePlaybackManager.currentOwner() != NativePlaybackManager.Owner.NONE) {
                promise.reject("E_VOD_PLAYBACK_BUSY", "Live playback has not finished closing. Return and try again.")
                return@runOnUiQueueThread
            }
            com.streamflixreborn.streamflix.charm.CharmSharedPlayback.configure(settings)
            promise.resolve(true)
        }
    }

    @ReactMethod fun surfaceMenu(promise: Promise) {
        context.runOnUiQueueThread {
            val activity = context.currentActivity as? androidx.fragment.app.FragmentActivity
            promise.resolve(activity != null && com.streamflixreborn.streamflix.charm.CharmPageDrawer.open(activity))
        }
    }

    @ReactMethod fun surfaceBack(promise: Promise) {
        context.runOnUiQueueThread {
            val activity = context.currentActivity as? androidx.fragment.app.FragmentActivity
            val host = activity?.supportFragmentManager?.findFragmentById(com.streamflixreborn.streamflix.R.id.nav_main_fragment) as? androidx.navigation.fragment.NavHostFragment
            val page = host?.childFragmentManager?.primaryNavigationFragment
            // The standalone host previously dispatched these inner layers.
            // Preserve that contract now that React owns the hardware Back key.
            val handled = if (page?.view == null) false else when (page) {
                is com.streamflixreborn.streamflix.fragments.player.PlayerTvFragment -> page.onBackPressed()
                is com.streamflixreborn.streamflix.fragments.player.PlayerMobileFragment -> page.onBackPressed()
                is com.streamflixreborn.streamflix.fragments.settings.SettingsTvFragment -> page.navigateBackInSettings()
                is com.streamflixreborn.streamflix.fragments.settings.SettingsMobileFragment -> page.navigateBackInSettings()
                else -> false
            }
            promise.resolve(handled || host?.navController?.popBackStack() == true)
        }
    }

    @ReactMethod fun surfaceStop(promise: Promise) {
        context.runOnUiQueueThread {
            val activity = context.currentActivity as? androidx.fragment.app.FragmentActivity
            val host = activity?.supportFragmentManager?.findFragmentById(com.streamflixreborn.streamflix.R.id.nav_main_fragment) as? androidx.navigation.fragment.NavHostFragment
            val page = host?.childFragmentManager?.primaryNavigationFragment
            val playerView = page?.view?.findViewById<androidx.media3.ui.PlayerView>(com.streamflixreborn.streamflix.R.id.pv_player)
            if (playerView == null || host.navController.currentDestination?.id != com.streamflixreborn.streamflix.R.id.player) {
                promise.resolve(false)
                return@runOnUiQueueThread
            }
            // Pausing synchronously invokes the existing player listener, which
            // persists progress and refreshes recent history before destruction.
            playerView.player?.pause()
            promise.resolve(host.navController.popBackStack())
        }
    }

    @ReactMethod
    fun copyDonationInvoice(invoice: String, promise: Promise) {
        try {
            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Lightning payment request", invoice))
            promise.resolve(true)
        } catch (error: Exception) { promise.reject("E_DONATION_COPY", "Could not copy the payment request.", error) }
    }

    init { context.addActivityEventListener(activityListener) }

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
                // Native VOD is another screen of MediaLab, not a second app launch.
                @Suppress("DEPRECATION")
                activity.overridePendingTransition(0, 0)
            } catch (error: Exception) {
                pending = null
                promise.reject("E_VOD_LAUNCH", "Could not open Video OnDemand.", error)
            }
        }
    }

    override fun invalidate() {
        context.removeActivityEventListener(activityListener)
        pending?.reject("E_VOD_CLOSED", "Charming MediaLab's screen was recreated.")
        pending = null
        libraryScope.cancel()
        super.invalidate()
    }

    companion object { private const val REQUEST_VOD = 7133 }
}

class CharmVodPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CharmVodModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = listOf(CharmVodSurfaceManager())
}
