package com.charmiptv.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

/**
 * Local, lightweight database maintenance only. Independent of provider
 * passwords, native VOD, and network access. Never runs while the TV UI or
 * player owns priority, and never races an XMLTV import for the same database.
 */
internal class EpgMaintenanceWorker(
  context: Context,
  params: WorkerParameters,
) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    if (!EpgImportCoordinator.canStartBackground()) return@withContext Result.success()
    val now = System.currentTimeMillis()
    // Never delete user-requested 14-day history. Routine importers already
    // purge more aggressively using their configured retention preferences.
    val cutoff = now - 14L * 24L * 60L * 60L * 1000L
    val dao = EpgControlDatabase.get(applicationContext).dao()
    val sourceIds = (listOf("default") + dao.enabledSources().map { it.playlistId }).distinct()
    try {
      for (sourceId in sourceIds) {
        coroutineContext.ensureActive()
        if (isStopped || !EpgImportCoordinator.canStartBackground())
          return@withContext Result.success()
        val database = if (sourceId == "default") EpgDatabase.shared(applicationContext)
          else CustomEpgStoreRegistry.database(applicationContext, sourceId)
        database.acquireImport().use {
          coroutineContext.ensureActive()
          if (isStopped || !EpgImportCoordinator.canStartBackground()) return@withContext Result.success()
          val deleted = database.deleteExpired(cutoff)
          database.maybeIncrementalVacuum(5_000, deleted)
        }
      }
      Result.success()
    } catch (failure: kotlinx.coroutines.CancellationException) {
      throw failure
    } catch (_: Exception) {
      Result.retry()
    }
  }
}
