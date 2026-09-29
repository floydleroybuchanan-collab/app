package com.charmiptv.app

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.models.Episode
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.ParentalControlUtils
import com.streamflixreborn.streamflix.database.AppDatabase
import org.json.JSONArray
import org.json.JSONObject
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
    private val libraryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var searchJob: Job? = null

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

    private suspend fun itemsJson(items: List<AppAdapter.Item>): String {
        val result = JSONArray()
        for (item in ParentalControlUtils.filterItems(items.take(30))) {
            val value = when (item) {
                is Movie -> JSONObject().put("id", item.id).put("title", item.title).put("poster", item.poster).put("section", "movie:" + item.id)
                is TvShow -> JSONObject().put("id", item.id).put("title", item.title).put("poster", item.poster).put("section", "show:" + item.id)
                is Episode -> item.tvShow?.let { show -> JSONObject().put("id", item.id).put("title", show.title + " · " + (item.title ?: "Episode " + item.number)).put("poster", show.poster).put("section", "show:" + show.id) }
                else -> null
            }
            if (value != null) result.put(value)
        }
        return result.toString()
    }

    @ReactMethod
    fun libraryItems(kind: String, promise: Promise) {
        libraryScope.launch {
            try {
                if (UserPreferences.currentProvider == null) { promise.resolve("[]"); return@launch }
                val db = AppDatabase.getInstance(context)
                val items: List<AppAdapter.Item> = if (kind == "favorites") {
                    db.movieDao().getFavorites().first() + db.tvShowDao().getFavorites().first()
                } else {
                    (db.movieDao().getWatchingMovies().first() + db.episodeDao().getWatchingEpisodes().first())
                        .sortedByDescending { (it as? com.streamflixreborn.streamflix.models.WatchItem)?.watchHistory?.lastEngagementTimeUtcMillis ?: 0 }
                }
                promise.resolve(itemsJson(items))
            } catch (error: Exception) { promise.reject("E_LIBRARY", "Your library could not be loaded.", error) }
        }
    }

    @ReactMethod
    fun searchLibrary(query: String, promise: Promise) {
        searchJob?.cancel()
        searchJob = libraryScope.launch {
            try {
                val provider = UserPreferences.currentProvider
                if (provider == null || query.isBlank()) { promise.resolve("[]"); return@launch }
                promise.resolve(itemsJson(withTimeout(20_000) { provider.search(query.take(200)) }))
            } catch (error: CancellationException) { promise.resolve("[]") }
              catch (error: Exception) { promise.reject("E_LIBRARY_SEARCH", "Movie and series search is unavailable. Try again.", error) }
        }
    }

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
        libraryScope.cancel()
        super.invalidate()
    }

    companion object { private const val REQUEST_VOD = 7133 }
}

class CharmVodPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CharmVodModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
