package com.charmiptv.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/** Persistent due-time signal, not a second credential-owning playlist importer. */
internal class PlaylistDueWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val prefs = applicationContext.getSharedPreferences("charm_playlist_schedule_v1", Context.MODE_PRIVATE)
    val account = prefs.getString("account", null)?.takeIf { it.isNotBlank() } ?: return Result.success()
    val epoch = prefs.getLong("epoch", 0)
    // Only the authenticated React pipeline can read Expo SecureStore and
    // protected managed-source credentials. Never duplicate those in WorkManager
    // InputData, plain SharedPreferences, logs or a background database.
    if (isStopped) return Result.success()
    if (prefs.getString("account", null) == account && prefs.getLong("epoch", 0) == epoch) {
      prefs.edit().putLong("dueAt", System.currentTimeMillis()).apply()
    }
    return Result.success()
  }
}
