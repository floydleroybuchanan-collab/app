package com.charmiptv.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.TimeUnit

/** Bridges only account identity + due flags. Credentials never cross into WorkManager. */
internal class PlaylistScheduleModule(private val react: ReactApplicationContext)
  : ReactContextBaseJavaModule(react) {
  private val prefs get() = react.getSharedPreferences("charm_playlist_schedule_v1", Context.MODE_PRIVATE)
  private val uniqueName = "charm-playlist-due-v1"
  override fun getName() = "CharmPlaylistSchedule"

  @ReactMethod fun setAccount(account: String?, promise: Promise) {
    try {
      val clean = account?.trim()?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,128}")) }
      val current = prefs.getString("account", null)
      if (current != clean) {
        prefs.edit().putString("account", clean).remove("dueAt")
          .putLong("epoch", prefs.getLong("epoch", 0) + 1).apply()
      }
      if (clean == null) {
        WorkManager.getInstance(react).cancelUniqueWork(uniqueName)
      } else {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<PlaylistDueWorker>(1, TimeUnit.HOURS)
          .setConstraints(constraints).build()
        WorkManager.getInstance(react).enqueueUniquePeriodicWork(
          uniqueName, ExistingPeriodicWorkPolicy.KEEP, request)
      }
      promise.resolve(true)
    } catch (failure: Exception) {
      promise.reject("PLAYLIST_SCHEDULE_FAILED", "Could not configure playlist background scheduling.", failure)
    }
  }

  @ReactMethod fun consumeDue(account: String, promise: Promise) {
    try {
      val clean = account.trim()
      val due = prefs.getString("account", null) == clean &&
        prefs.getLong("dueAt", 0) > 0L
      if (due) prefs.edit().remove("dueAt").apply()
      promise.resolve(due)
    } catch (failure: Exception) {
      promise.reject("PLAYLIST_DUE_FAILED", "Could not check playlist update schedule.", failure)
    }
  }
}

class PlaylistSchedulePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(PlaylistScheduleModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
