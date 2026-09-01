package com.charmiptv.app

import android.content.Context
import android.os.Build
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlin.math.min

internal object EpgUpdateScheduler {
  private const val UNIQUE_WORK = "charm-epg-update-scheduler-v2"
  private const val PREFS = "charm_epg_scheduler_policy"

  fun install(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val network = if (prefs.getBoolean("unmetered", false)) NetworkType.UNMETERED else NetworkType.CONNECTED
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(network)
      .setRequiresCharging(prefs.getBoolean("charging", false))
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) setRequiresDeviceIdle(prefs.getBoolean("idle", false))
      }
      .build()
    val request = PeriodicWorkRequestBuilder<EpgUpdateWorker>(1, TimeUnit.HOURS)
      .setConstraints(constraints)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
      .build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(
      UNIQUE_WORK,
      ExistingPeriodicWorkPolicy.UPDATE,
      request,
    )
  }

  fun configure(context: Context, unmetered: Boolean, charging: Boolean, idle: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean("unmetered", unmetered)
      .putBoolean("charging", charging)
      .putBoolean("idle", idle)
      .apply()
    install(context)
  }
}

internal class EpgUpdateWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result {
    val nowSeconds = System.currentTimeMillis() / 1000L
    val dao = EpgControlDatabase.get(applicationContext).dao()
    val updater = BackgroundEpgUpdater(applicationContext)
    var retryNeeded = false
    var refreshed = false
    for (source in dao.enabledSources()) {
      // Zero is the explicit manual-only schedule. Keep the source enabled for
      // Guide reads while excluding it from durable background work.
      if (source.refreshHours <= 0) continue
      val previous = dao.importState(source.playlistId)
      if ((previous?.blackoutUntilSeconds ?: 0L) > nowSeconds) continue
      if ((previous?.nextRetrySeconds ?: 0L) > nowSeconds) continue
      val interval = source.refreshHours.coerceIn(1, 168) * 3600L
      val lastSuccess = previous?.lastSuccessSeconds ?: 0L
      if (lastSuccess > 0L && nowSeconds - lastSuccess < interval) continue

      val attempt = (previous?.attemptCount ?: 0) + 1
      val startedMs = System.currentTimeMillis()
      val historyId = dao.addUpdateHistory(EpgUpdateHistoryEntity(
        sourceId = source.playlistId,
        kind = "epg",
        state = "running",
        trigger = "workmanager",
        attempt = attempt,
        startedAtSeconds = startedMs / 1000L,
      ))
      dao.putImportState(EpgImportStateEntity(
        playlistId = source.playlistId,
        lastAttemptSeconds = startedMs / 1000L,
        lastSuccessSeconds = previous?.lastSuccessSeconds ?: 0L,
        blackoutUntilSeconds = previous?.blackoutUntilSeconds ?: 0L,
        state = "running",
        attemptCount = attempt,
        lastProgrammeCount = previous?.lastProgrammeCount ?: 0L,
        lastTrigger = "workmanager",
      ))
      try {
        val result = updater.refresh(source)
        val finishedMs = System.currentTimeMillis()
        dao.putImportState(EpgImportStateEntity(
          playlistId = source.playlistId,
          lastAttemptSeconds = startedMs / 1000L,
          lastSuccessSeconds = if (result.swapped) finishedMs / 1000L else previous?.lastSuccessSeconds ?: 0L,
          state = if (result.swapped) "succeeded" else "waiting_for_bindings",
          attemptCount = 0,
          lastDurationMs = finishedMs - startedMs,
          lastProgrammeCount = result.programmeCount,
          lastTrigger = "workmanager",
        ))
        dao.finishUpdateHistory(historyId, if (result.swapped) "succeeded" else "waiting_for_bindings", finishedMs / 1000L, result.programmeCount, "")
        refreshed = refreshed || result.swapped
      } catch (t: Throwable) {
        val finishedMs = System.currentTimeMillis()
        val delayMinutes = min(12 * 60L, 15L * (1L shl min(5, attempt - 1)))
        val message = EpgDiagnosticSafety.message(t)
        dao.putImportState(EpgImportStateEntity(
          playlistId = source.playlistId,
          lastAttemptSeconds = startedMs / 1000L,
          lastSuccessSeconds = previous?.lastSuccessSeconds ?: 0L,
          blackoutUntilSeconds = previous?.blackoutUntilSeconds ?: 0L,
          lastError = message,
          state = "retry_scheduled",
          attemptCount = attempt,
          nextRetrySeconds = finishedMs / 1000L + delayMinutes * 60L,
          lastDurationMs = finishedMs - startedMs,
          lastProgrammeCount = previous?.lastProgrammeCount ?: 0L,
          lastTrigger = "workmanager",
        ))
        dao.finishUpdateHistory(historyId, "failed", finishedMs / 1000L, 0L, message)
        retryNeeded = true
      }
    }
    dao.trimUpdateHistory(100)
    applicationContext.getSharedPreferences("charm_epg_scheduler", Context.MODE_PRIVATE)
      .edit()
      .putBoolean("refresh_due", retryNeeded)
      .putBoolean("background_refreshed", refreshed)
      .putLong("checked_at_seconds", nowSeconds)
      .apply()
    return if (retryNeeded) Result.retry() else Result.success()
  }
}
