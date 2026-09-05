package com.charmiptv.app

import android.util.Xml
import android.database.sqlite.SQLiteException
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream
import kotlin.math.exp

class EpgNativeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  // Shared across every owner of the primary EPG store (this module, EpgRamModule,
  // NativeGuideView) — see EpgDatabase.shared() for why. Never closed here.
  private val database = EpgDatabase.shared(reactContext)
  // Registry retains the legacy charm_epg_user_v1.db store while adding one
  // independent transactional database per additional custom EPG source.
  private val userDatabase = CustomEpgStoreRegistry.database(reactContext, USER_SOURCE_ID)
  private val controlDao = EpgControlDatabase.get(reactContext).dao()
  private val combinedGuide = CombinedGuideRepository(reactContext)

  // Refresh/network/XML work is intentionally isolated from guide reads. A slow
  // EPG download must never queue bounded Guide reads behind it; WAL lets the
  // query executor keep serving the last-good live table until the final swap.
  private val refreshExecutor = Executors.newSingleThreadExecutor { task ->
    Thread({ android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); task.run() }, "charm-primary-epg-import")
  }
  private val playlistExecutor = Executors.newSingleThreadExecutor()
  private val queryExecutor = Executors.newFixedThreadPool(2)
  @Volatile private var guideHistoryMs = DEFAULT_GUIDE_HISTORY_MS

  override fun getName(): String = "CharmEpg"

  private fun emitImportProgress(phase: String, ratio: Double) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("CharmEpgImportProgress", Arguments.createMap().apply {
        putString("phase", phase)
        putDouble("ratio", ratio.coerceIn(0.2, 0.9))
      })
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  @ReactMethod
  fun configureBackgroundUpdatePolicy(unmetered: Boolean, charging: Boolean, idle: Boolean, promise: Promise) {
    try {
      EpgUpdateScheduler.configure(reactContext, unmetered, charging, idle)
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("EPG_BACKGROUND_POLICY_FAILED", t.message ?: "Could not save background update policy", t)
    }
  }

  @ReactMethod
  fun configureSourceTiming(sourceId: String, serverMinutes: Double, playlistMinutes: Double, globalMinutes: Double, channelOffsets: ReadableMap, promise: Promise) {
    refreshExecutor.execute {
      try {
        val id = if (sourceId.trim() == DEFAULT_PLAYLIST_ID) DEFAULT_PLAYLIST_ID else CustomEpgStoreRegistry.normalizeSourceId(sourceId)
        val previous = controlDao.source(id)
        controlDao.putSource(EpgSourceEntity(
          playlistId = id,
          url = previous?.url.orEmpty(),
          enabled = previous?.enabled ?: false,
          refreshHours = previous?.refreshHours ?: 12,
          serverOffsetMinutes = serverMinutes.toInt().coerceIn(-1440, 1440),
          playlistOffsetMinutes = playlistMinutes.toInt().coerceIn(-1440, 1440),
          updatedAtSeconds = System.currentTimeMillis() / 1000L,
        ))
        controlDao.clearChannelOffsets(id)
        val offsets = ArrayList<EpgChannelOffsetEntity>()
        val iterator = channelOffsets.keySetIterator()
        while (iterator.hasNextKey()) {
          val channelId = iterator.nextKey()
          if (channelOffsets.getType(channelId) != com.facebook.react.bridge.ReadableType.Number) continue
          offsets.add(EpgChannelOffsetEntity(id, channelId, channelOffsets.getDouble(channelId).toInt().coerceIn(-1440, 1440)))
          if (offsets.size >= MAX_USER_BINDINGS) break
        }
        if (offsets.isNotEmpty()) controlDao.putChannelOffsets(offsets)
        GuideTimingPolicy.setGlobalOffsetMinutes(reactContext, globalMinutes.toInt())
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_TIMING_CONFIG_FAILED", t.message ?: "Could not save Guide timing", t)
      }
    }
  }

  @ReactMethod
  fun getUpdateDiagnostics(promise: Promise) {
    queryExecutor.execute {
      try {
        val states = Arguments.createArray()
        for (state in controlDao.allImportStates()) states.pushMap(Arguments.createMap().apply {
          putString("sourceId", state.playlistId)
          putString("state", state.state)
          putInt("attemptCount", state.attemptCount)
          putDouble("lastAttemptSeconds", state.lastAttemptSeconds.toDouble())
          putDouble("lastSuccessSeconds", state.lastSuccessSeconds.toDouble())
          putDouble("nextRetrySeconds", state.nextRetrySeconds.toDouble())
          putDouble("lastDurationMs", state.lastDurationMs.toDouble())
          putDouble("lastProgrammeCount", state.lastProgrammeCount.toDouble())
          putString("lastTrigger", state.lastTrigger)
          putString("lastError", state.lastError)
        })
        val history = Arguments.createArray()
        for (row in controlDao.recentUpdateHistory(30)) history.pushMap(Arguments.createMap().apply {
          putDouble("id", row.id.toDouble())
          putString("sourceId", row.sourceId)
          putString("kind", row.kind)
          putString("state", row.state)
          putString("trigger", row.trigger)
          putInt("attempt", row.attempt)
          putDouble("startedAtSeconds", row.startedAtSeconds.toDouble())
          putDouble("finishedAtSeconds", row.finishedAtSeconds.toDouble())
          putDouble("rowCount", row.rowCount.toDouble())
          putString("error", row.error)
        })
        promise.resolve(Arguments.createMap().apply {
          putArray("states", states)
          putArray("history", history)
        })
      } catch (t: Throwable) {
        promise.reject("EPG_UPDATE_DIAGNOSTICS_FAILED", t.message ?: "Could not read update diagnostics", t)
      }
    }
  }

  @ReactMethod
  fun startExternalUpdateJob(sourceId: String, kind: String, trigger: String, promise: Promise) {
    queryExecutor.execute {
      try {
        val id = controlDao.addUpdateHistory(EpgUpdateHistoryEntity(sourceId = sourceId.trim().take(80), kind = kind.trim().take(24), state = "running", trigger = trigger.trim().take(24), attempt = 1, startedAtSeconds = System.currentTimeMillis() / 1000L))
        promise.resolve(id.toDouble())
      } catch (t: Throwable) { promise.reject("UPDATE_JOB_START_FAILED", t.message ?: "Could not record update job", t) }
    }
  }

  @ReactMethod
  fun finishExternalUpdateJob(id: Double, state: String, rowCount: Double, error: String, promise: Promise) {
    queryExecutor.execute {
      try {
        controlDao.finishUpdateHistory(id.toLong(), state.trim().take(32), System.currentTimeMillis() / 1000L, rowCount.toLong().coerceAtLeast(0), error.trim().take(500))
        controlDao.trimUpdateHistory(100)
        promise.resolve(true)
      } catch (t: Throwable) { promise.reject("UPDATE_JOB_FINISH_FAILED", t.message ?: "Could not finish update job", t) }
    }
  }

  @ReactMethod
  fun configureSource(
    playlistId: String,
    url: String,
    refreshHours: Double,
    serverOffsetMinutes: Double,
    playlistOffsetMinutes: Double,
    channelOffsets: ReadableMap,
    pastDays: Double,
    promise: Promise,
  ) {
    refreshExecutor.execute {
      try {
        guideHistoryMs = pastDays.toInt().coerceIn(1, 14) * 24L * 60L * 60L * 1000L
        val id = playlistId.trim().ifEmpty { DEFAULT_PLAYLIST_ID }
        controlDao.putSource(
          EpgSourceEntity(
            playlistId = id,
            url = url.trim(),
            // Guide visibility and automatic scheduling are separate choices.
            // A zero-hour interval means manual updates; it must not hide an
            // already downloaded Guide from the canvas.
            enabled = controlDao.source(id)?.enabled ?: url.isNotBlank(),
            refreshHours = refreshHours.toInt().coerceIn(0, 168),
            serverOffsetMinutes = serverOffsetMinutes.toInt().coerceIn(-1440, 1440),
            playlistOffsetMinutes = playlistOffsetMinutes.toInt().coerceIn(-1440, 1440),
            updatedAtSeconds = System.currentTimeMillis() / 1000L,
          )
        )
        controlDao.clearChannelOffsets(id)
        val rows = ArrayList<EpgChannelOffsetEntity>()
        val iterator = channelOffsets.keySetIterator()
        while (iterator.hasNextKey()) {
          val channelId = iterator.nextKey()
          if (channelOffsets.getType(channelId) != com.facebook.react.bridge.ReadableType.Number) continue
          rows.add(
            EpgChannelOffsetEntity(
              playlistId = id,
              channelId = channelId,
              offsetMinutes = channelOffsets.getDouble(channelId).toInt().coerceIn(-1440, 1440),
            )
          )
        }
        if (rows.isNotEmpty()) controlDao.putChannelOffsets(rows)
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_SOURCE_CONFIG_FAILED", t.message ?: "Could not save Guide source settings", t)
      }
    }
  }

  @ReactMethod
  fun configureGuideOwnership(
    primaryEnabled: Boolean,
    userEnabled: Boolean,
    userUrl: String,
    userOverrides: ReadableMap,
    promise: Promise,
  ) {
    refreshExecutor.execute {
      try {
        val now = System.currentTimeMillis() / 1000L
        val primary = controlDao.source(DEFAULT_PLAYLIST_ID)
        val primaryUnchanged = primary != null && primary.enabled == primaryEnabled
        controlDao.putSource(
          EpgSourceEntity(
            playlistId = DEFAULT_PLAYLIST_ID,
            url = primary?.url.orEmpty(),
            enabled = primaryEnabled,
            refreshHours = primary?.refreshHours ?: 12,
            serverOffsetMinutes = primary?.serverOffsetMinutes ?: 0,
            playlistOffsetMinutes = primary?.playlistOffsetMinutes ?: 0,
            updatedAtSeconds = if (primaryUnchanged) primary?.updatedAtSeconds ?: now else now,
          )
        )
        val previousUser = controlDao.source(USER_SOURCE_ID)
        val cleanUserUrl = userUrl.trim()
        val userSourceEnabled = userEnabled && cleanUserUrl.isNotEmpty()
        val userUnchanged = previousUser != null && previousUser.url == cleanUserUrl && previousUser.enabled == userSourceEnabled
        controlDao.putSource(
          EpgSourceEntity(
            playlistId = USER_SOURCE_ID,
            url = cleanUserUrl,
            enabled = userSourceEnabled,
            refreshHours = previousUser?.refreshHours ?: 12,
            serverOffsetMinutes = previousUser?.serverOffsetMinutes ?: 0,
            playlistOffsetMinutes = previousUser?.playlistOffsetMinutes ?: 0,
            updatedAtSeconds = if (userUnchanged) previousUser?.updatedAtSeconds ?: now else now,
          )
        )
        val bindings = ArrayList<EpgChannelBindingEntity>()
        val iterator = userOverrides.keySetIterator()
        while (iterator.hasNextKey()) {
          val channelId = iterator.nextKey().trim()
          val xmltvId = userOverrides.getString(channelId)?.trim().orEmpty()
          if (channelId.isEmpty() || xmltvId.isEmpty()) continue
          bindings.add(EpgChannelBindingEntity(USER_SOURCE_ID, channelId, xmltvId))
          if (bindings.size >= MAX_USER_BINDINGS) break
        }
        controlDao.replaceChannelBindings(USER_SOURCE_ID, bindings)
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_OWNERSHIP_CONFIG_FAILED", t.message ?: "Could not save Guide ownership", t)
      }
    }
  }

  @ReactMethod
  fun configureUserGuideSources(primaryEnabled: Boolean, sources: ReadableArray, promise: Promise) {
    refreshExecutor.execute {
      try {
        val now = System.currentTimeMillis() / 1000L
        val primary = controlDao.source(DEFAULT_PLAYLIST_ID)
        val primaryUpdatedAt = if (primary != null && primary.enabled == primaryEnabled) primary.updatedAtSeconds else now
        controlDao.putSource(EpgSourceEntity(
          playlistId = DEFAULT_PLAYLIST_ID, url = primary?.url.orEmpty(), enabled = primaryEnabled,
          refreshHours = primary?.refreshHours ?: 12,
          serverOffsetMinutes = primary?.serverOffsetMinutes ?: 0,
          playlistOffsetMinutes = primary?.playlistOffsetMinutes ?: 0,
          updatedAtSeconds = primaryUpdatedAt,
        ))
        val keep = LinkedHashSet<String>()
        for (index in 0 until sources.size()) {
          val row = sources.getMap(index) ?: continue
          val sourceId = CustomEpgStoreRegistry.normalizeSourceId(row.getString("id").orEmpty())
          val url = row.getString("url").orEmpty().trim()
          val enabled = row.hasKey("enabled") && row.getBoolean("enabled") && url.isNotEmpty()
          val previous = controlDao.source(sourceId)
          val refreshHours = if (row.hasKey("refreshHours")) row.getInt("refreshHours").coerceIn(0, 24) else previous?.refreshHours ?: 12
          val unchanged = previous != null && previous.url == url && previous.enabled == enabled && previous.refreshHours == refreshHours
          controlDao.putSource(EpgSourceEntity(
            playlistId = sourceId, url = url, enabled = enabled,
            refreshHours = refreshHours,
            serverOffsetMinutes = previous?.serverOffsetMinutes ?: 0,
            playlistOffsetMinutes = previous?.playlistOffsetMinutes ?: 0,
            updatedAtSeconds = if (unchanged) previous.updatedAtSeconds else now,
          ))
          keep.add(sourceId)
        }
        for (existing in controlDao.userSources()) {
          if (existing.playlistId != USER_SOURCE_ID && existing.playlistId !in keep) controlDao.removeUserSource(existing.playlistId)
        }
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_MULTI_SOURCE_CONFIG_FAILED", t.message ?: "Could not save custom Guide sources", t)
      }
    }
  }

  @ReactMethod
  fun consumeScheduledRefreshDue(promise: Promise) {
    val prefs = reactContext.getSharedPreferences("charm_epg_scheduler", 0)
    val due = prefs.getBoolean("refresh_due", false)
    if (due) prefs.edit().putBoolean("refresh_due", false).apply()
    promise.resolve(due)
  }

  @ReactMethod
  fun fetchPlaylist(url: String, promise: Promise) {
    playlistExecutor.execute {
      try {
        val documentStream = if (url.startsWith("content://")) reactContext.contentResolver.openInputStream(android.net.Uri.parse(url)) ?: throw IllegalArgumentException("Playlist document is unavailable") else null
        val parsed = NativePlaylistParser.fetch(url, documentStream)
        val channels = Arguments.createArray()
        for (channel in parsed.channels) {
          channels.pushMap(Arguments.createMap().apply {
            putString("id", channel.id)
            putString("raw_tvg_id", channel.rawTvgId)
            putString("tvg_id", channel.rawTvgId)
            putString("name", channel.name)
            putString("logo", channel.logo)
            putString("playlist_logo", channel.logo)
            putString("group", channel.group)
            putString("url", channel.url)
            putString("stream_type", channel.streamType)
          })
        }
        promise.resolve(Arguments.createMap().apply {
          putArray("channels", channels)
          putInt("rejected", parsed.rejected)
          putBoolean("truncated", parsed.truncated)
          putString("epgHeader", parsed.epgHeader)
        })
      } catch (t: Throwable) {
        promise.reject("PLAYLIST_FETCH_FAILED", t.message ?: "Native playlist refresh failed", t)
      }
    }
  }

  @ReactMethod
  fun refresh(
    url: String,
    allowNotModified: Boolean,
    activeXmltvIds: ReadableArray,
    activeChannelNames: ReadableArray,
    promise: Promise,
  ) {
    val activeIds = HashSet<String>(activeXmltvIds.size())
    for (i in 0 until activeXmltvIds.size()) {
      activeXmltvIds.getString(i)?.trim()?.takeIf { it.isNotEmpty() }?.let { activeIds.add(it.lowercase()) }
    }
    val activeNames = HashSet<String>(activeChannelNames.size())
    for (i in 0 until activeChannelNames.size()) {
      activeChannelNames.getString(i)?.let(::normalizeGuideKey)?.takeIf { it.isNotEmpty() }?.let(activeNames::add)
    }
    refreshExecutor.execute {
      val startedMs = System.currentTimeMillis()
      val previousState = runCatching { controlDao.importState(DEFAULT_PLAYLIST_ID) }.getOrNull()
      val attempt = (previousState?.attemptCount ?: 0) + 1
      val historyId = runCatching { controlDao.addUpdateHistory(EpgUpdateHistoryEntity(sourceId = DEFAULT_PLAYLIST_ID, kind = "epg", state = "running", trigger = "manual", attempt = attempt, startedAtSeconds = startedMs / 1000L)) }.getOrDefault(0L)
      runCatching { controlDao.putImportState(EpgImportStateEntity(playlistId = DEFAULT_PLAYLIST_ID, lastAttemptSeconds = startedMs / 1000L, lastSuccessSeconds = previousState?.lastSuccessSeconds ?: 0L, state = "running", attemptCount = attempt, lastProgrammeCount = previousState?.lastProgrammeCount ?: 0L, lastTrigger = "manual")) }
      try {
        val fallbackBlackout = reactContext.getSharedPreferences(DB_RECOVERY_PREFS, 0)
          .getLong(DB_BLACKOUT_UNTIL_KEY, 0L)
        val databaseBlackout = try {
          database.getMeta(DB_BLACKOUT_UNTIL_KEY)?.toLongOrNull() ?: 0L
        } catch (_: Throwable) {
          0L
        }
        val blackoutUntil = maxOf(fallbackBlackout, databaseBlackout)
        if (blackoutUntil > System.currentTimeMillis()) {
          throw IllegalStateException("Guide database recovery pause is active")
        }
        emitImportProgress("downloading", 0.2)
        if (!database.ensureHealthy()) {
          throw SQLiteException("Guide database integrity check failed")
        }
        database.assertRefreshStorageAvailable()
        val now = System.currentTimeMillis()
        val sourceConfig = controlDao.source(DEFAULT_PLAYLIST_ID)
        val baseOffsetMs = ((sourceConfig?.serverOffsetMinutes ?: 0) +
          (sourceConfig?.playlistOffsetMinutes ?: 0) + GuideTimingPolicy.globalOffsetMinutes(reactContext)).toLong() * 60_000L
        val configuredOffsets = controlDao.channelOffsets(DEFAULT_PLAYLIST_ID).associate { it.channelId to it.offsetMinutes.toLong() * 60_000L }
        val channelOffsetMs = HashMap<String, Long>(configuredOffsets)
        for (row in database.activePlaylistChannels()) configuredOffsets[row.playlistId]?.let { channelOffsetMs[row.matchedXmltvId] = it }
        val minStop = now - guideHistoryMs
        val maxStart = now + GUIDE_WINDOW_MS
        val channelLogos = LinkedHashMap<String, String>()
        val channelNames = LinkedHashMap<String, String>()
        val channelIdsWithPrograms = LinkedHashSet<String>()
        val httpValidators = EpgHttpValidators()
        try {
          val batches = streamProgramBatches(
            url,
            minStop,
            maxStart,
            channelLogos,
            channelNames,
            channelIdsWithPrograms,
            httpValidators,
            allowNotModified,
            activeIds,
            activeNames,
            baseOffsetMs,
            channelOffsetMs,
          )
          database.replaceBatches(batches)
          emitImportProgress("indexing", 0.9)
        } catch (_: EpgNotModifiedException) {
          val guideEpoch = database.getMeta("guide_epoch")?.toLongOrNull() ?: 0L
          val count = database.count()
          val finishedMs = System.currentTimeMillis()
          controlDao.putImportState(EpgImportStateEntity(playlistId = DEFAULT_PLAYLIST_ID, lastAttemptSeconds = startedMs / 1000L, lastSuccessSeconds = finishedMs / 1000L, state = "not_modified", attemptCount = 0, lastDurationMs = finishedMs - startedMs, lastProgrammeCount = count, lastTrigger = "manual"))
          if (historyId > 0L) controlDao.finishUpdateHistory(historyId, "not_modified", finishedMs / 1000L, count, "")
          val result = Arguments.createMap().apply {
            putDouble("count", count.toDouble())
            putDouble("windowStartMs", (now - guideHistoryMs).toDouble())
            putDouble("windowEndMs", maxStart.toDouble())
            putDouble("guideEpoch", guideEpoch.toDouble())
            putBoolean("notModified", true)
          }
          promise.resolve(result)
          return@execute
        }

        // Soft guide epoch — independent of playlist last-good (no joint snapshot).
        // Persist aliases for SQL joins / future native rematch; JS still owns match policy.
        val aliases = ArrayList<Triple<String, String, String>>(channelNames.size + channelIdsWithPrograms.size)
        for ((channelId, displayName) in channelNames) {
          aliases.add(Triple(channelId, "display_name", displayName))
          aliases.add(Triple(channelId, "xmltv_id", channelId))
        }
        for ((channelId, logoUrl) in channelLogos) {
          if (logoUrl.isNotBlank()) aliases.add(Triple(channelId, "icon_url", logoUrl))
        }
        for (channelId in channelIdsWithPrograms) {
          aliases.add(Triple(channelId, "has_programs", channelId))
          if (!channelNames.containsKey(channelId)) {
            aliases.add(Triple(channelId, "xmltv_id", channelId))
          }
        }
        database.replaceChannelAliases(aliases)

        val guideEpoch = (database.getMeta("guide_epoch")?.toLongOrNull() ?: 0L) + 1L
        database.setMeta("guide_epoch", guideEpoch.toString())
        database.setMeta("guide_refreshed_at", now.toString())
        database.setMeta(HTTP_SOURCE_HASH_KEY, httpValidators.sourceHash)
        database.setMeta(HTTP_ETAG_KEY, httpValidators.etag)
        database.setMeta(HTTP_LAST_MODIFIED_KEY, httpValidators.lastModified)
        database.setMeta(DB_BLACKOUT_UNTIL_KEY, "0")
        reactContext.getSharedPreferences(DB_RECOVERY_PREFS, 0).edit()
          .remove(DB_BLACKOUT_UNTIL_KEY)
          .apply()
        controlDao.putImportState(
          EpgImportStateEntity(
            playlistId = DEFAULT_PLAYLIST_ID,
            lastAttemptSeconds = now / 1000L,
            lastSuccessSeconds = now / 1000L,
            state = "succeeded",
            attemptCount = 0,
            lastDurationMs = System.currentTimeMillis() - startedMs,
            lastProgrammeCount = database.count(),
            lastTrigger = "manual",
          )
        )
        if (historyId > 0L) controlDao.finishUpdateHistory(historyId, "succeeded", System.currentTimeMillis() / 1000L, database.count(), "")

        val deleted = database.deleteExpired(now - guideHistoryMs)
        // Rare idle reclaim only after a large expiry — never every refresh.
        database.maybeIncrementalVacuum(MIN_VACUUM_DELETED_ROWS, deleted)
        val logos = Arguments.createMap()
        for ((channelId, logoUrl) in channelLogos) {
          logos.putString(channelId, logoUrl)
        }
        val names = Arguments.createMap()
        for ((channelId, channelName) in channelNames) {
          names.putString(channelId, channelName)
        }
        val programIds = Arguments.createArray()
        for (channelId in channelIdsWithPrograms) {
          programIds.pushString(channelId)
        }

        val result = Arguments.createMap().apply {
          putDouble("count", database.count().toDouble())
          putDouble("windowStartMs", (now - guideHistoryMs).toDouble())
          putDouble("windowEndMs", maxStart.toDouble())
          putDouble("guideEpoch", guideEpoch.toDouble())
          putMap("channelLogos", logos)
          putMap("channelNames", names)
          putArray("channelIdsWithPrograms", programIds)
        }
        promise.resolve(result)
      } catch (t: Throwable) {
        try {
          val previous = controlDao.importState(DEFAULT_PLAYLIST_ID)
          controlDao.putImportState(
            EpgImportStateEntity(
              playlistId = DEFAULT_PLAYLIST_ID,
              lastAttemptSeconds = System.currentTimeMillis() / 1000L,
              lastSuccessSeconds = previous?.lastSuccessSeconds ?: 0L,
              blackoutUntilSeconds = if (isCatastrophicDatabaseFailure(t))
                System.currentTimeMillis() / 1000L + 3600L else previous?.blackoutUntilSeconds ?: 0L,
              lastError = EpgDiagnosticSafety.message(t),
              state = "failed",
              attemptCount = attempt,
              lastDurationMs = System.currentTimeMillis() - startedMs,
              lastProgrammeCount = previous?.lastProgrammeCount ?: 0L,
              lastTrigger = "manual",
            )
          )
          if (historyId > 0L) controlDao.finishUpdateHistory(historyId, "failed", System.currentTimeMillis() / 1000L, 0L, EpgDiagnosticSafety.message(t))
          controlDao.trimUpdateHistory(100)
        } catch (_: Throwable) {}
        if (isCatastrophicDatabaseFailure(t)) {
          try {
            database.setMeta(DB_BLACKOUT_UNTIL_KEY, (System.currentTimeMillis() + DB_BLACKOUT_MS).toString())
          } catch (_: Throwable) {
            // The database can be too damaged to persist its own recovery gate.
            reactContext.getSharedPreferences(DB_RECOVERY_PREFS, 0).edit()
              .putLong(DB_BLACKOUT_UNTIL_KEY, System.currentTimeMillis() + DB_BLACKOUT_MS)
              .apply()
          }
        }
        promise.reject("EPG_REFRESH_FAILED", t.message ?: "Native EPG refresh failed", t)
      }
    }
  }

  @ReactMethod
  fun getWindow(startMs: Double, endMs: Double, channelIds: ReadableArray, promise: Promise) {
    queryExecutor.execute {
      try {
        val start = startMs.toLong()
        val end = endMs.toLong()
        if (end <= start || end - start > MAX_QUERY_WINDOW_MS) {
          throw IllegalArgumentException("Invalid EPG query window")
        }
        val ids = ArrayList<String>(channelIds.size())
        for (i in 0 until channelIds.size()) {
          val id = channelIds.getString(i)?.trim()
          if (!id.isNullOrEmpty()) ids.add(id)
        }
        val programmes = database.queryWindow(start, end, ids)
        promise.resolve(groupPrograms(programmes))
      } catch (t: Throwable) {
        promise.reject("EPG_WINDOW_FAILED", t.message ?: "Could not read native EPG window", t)
      }
    }
  }

  /**
   * Fast path for the TV guide: JOIN playlist_epg_matches → epg_programmes and
   * return programmes keyed by playlist channel id (not XMLTV id).
   */
  @ReactMethod
  fun queryGuideWindow(startMs: Double, endMs: Double, playlistChannelIds: ReadableArray, promise: Promise) {
    queryExecutor.execute {
      try {
        val start = startMs.toLong()
        val end = endMs.toLong()
        if (end <= start || end - start > MAX_QUERY_WINDOW_MS) {
          throw IllegalArgumentException("Invalid EPG query window")
        }
        val ids = ArrayList<String>(playlistChannelIds.size())
        for (i in 0 until playlistChannelIds.size()) {
          val id = playlistChannelIds.getString(i)?.trim()
          if (!id.isNullOrEmpty()) ids.add(id)
        }
        promise.resolve(groupPrograms(combinedGuide.queryGuideWindow(start, end, ids)))
      } catch (t: Throwable) {
        promise.reject("EPG_GUIDE_WINDOW_FAILED", t.message ?: "Could not read joined EPG window", t)
      }
    }
  }

  @ReactMethod
  fun getStoredPlaylist(promise: Promise) {
    queryExecutor.execute {
      try {
        val rows = database.activePlaylistChannels()
        val primaryEnabled = controlDao.source(DEFAULT_PLAYLIST_ID)?.enabled ?: true
        val userSource = controlDao.source(USER_SOURCE_ID)
        val userEnabled = userSource?.enabled == true && userSource.url.isNotBlank()
        val userBindings = if (userEnabled) controlDao.effectiveBindings(USER_SOURCE_ID) else emptyList()
        val extraSources = controlDao.userSources().filter { it.enabled && it.url.isNotBlank() }
        val hasUserOwnership = (userEnabled && userBindings.isNotEmpty()) || extraSources.any { controlDao.effectiveBindings(it.playlistId).isNotEmpty() }
        val bindingByPlaylist = userBindings.associate { it.channelId to it.xmltvId }
        val userIcons = if (bindingByPlaylist.isNotEmpty()) userDatabase.iconAliases(bindingByPlaylist.values.toSet()) else emptyMap()
        val customLogoByPlaylist = HashMap<String, String>()
        bindingByPlaylist.forEach { (playlistId, xmltvId) -> userIcons[xmltvId]?.let { customLogoByPlaylist[playlistId] = it } }
        val primaryGuideEpoch = database.getMeta("guide_epoch")?.toLongOrNull() ?: 0L
        val userGuideEpoch = userDatabase.getMeta("guide_epoch")?.toLongOrNull() ?: 0L
        val primaryGuideRefreshedAt = database.getMeta("guide_refreshed_at")?.toLongOrNull() ?: 0L
        val userGuideRefreshedAt = userDatabase.getMeta("guide_refreshed_at")?.toLongOrNull() ?: 0L
        val userProgramCount = userDatabase.count()
        var combinedUserGuideEpoch = if (userEnabled && userBindings.isNotEmpty()) userGuideEpoch else 0L
        var combinedUserRefreshedAt = if (userEnabled && userBindings.isNotEmpty()) userGuideRefreshedAt else 0L
        var combinedUserProgramCount = if (userEnabled && userBindings.isNotEmpty()) userProgramCount else 0L
        for (source in extraSources) {
          val sourceBindings = controlDao.effectiveBindings(source.playlistId)
          if (sourceBindings.isEmpty()) continue
          val sourceDatabase = CustomEpgStoreRegistry.database(reactContext, source.playlistId)
          val xmltvIds = sourceBindings.map { it.xmltvId }.toSet()
          val icons = sourceDatabase.iconAliases(xmltvIds)
          sourceBindings.forEach { binding -> icons[binding.xmltvId]?.let { customLogoByPlaylist[binding.channelId] = it } }
          combinedUserGuideEpoch += sourceDatabase.getMeta("guide_epoch")?.toLongOrNull() ?: 0L
          val refreshedAt = sourceDatabase.getMeta("guide_refreshed_at")?.toLongOrNull() ?: 0L
          combinedUserRefreshedAt = when {
            refreshedAt <= 0L -> 0L
            combinedUserRefreshedAt <= 0L -> refreshedAt
            else -> minOf(combinedUserRefreshedAt, refreshedAt)
          }
          combinedUserProgramCount += sourceDatabase.count()
        }
        val effectiveGuideEpoch =
          (if (primaryEnabled) primaryGuideEpoch else 0L) +
            (if (hasUserOwnership) combinedUserGuideEpoch else 0L)
        val effectiveGuideRefreshedAt = when {
          primaryEnabled && hasUserOwnership ->
            if (primaryGuideRefreshedAt > 0L && combinedUserRefreshedAt > 0L)
              minOf(primaryGuideRefreshedAt, combinedUserRefreshedAt) else 0L
          primaryEnabled -> primaryGuideRefreshedAt
          hasUserOwnership -> combinedUserRefreshedAt
          else -> 0L
        }
        val primaryProgramCount = database.count()
        val effectiveProgramCount =
          (if (primaryEnabled) primaryProgramCount else 0L) +
            (if (hasUserOwnership) combinedUserProgramCount else 0L)
        val channels = Arguments.createArray()
        for (row in rows) {
          val effectiveEpgLogo = customLogoByPlaylist[row.playlistId] ?: row.epgLogo
          channels.pushMap(Arguments.createMap().apply {
            putString("id", row.playlistId)
            putString("raw_tvg_id", row.rawTvgId)
            putString("tvg_id", row.matchedXmltvId.ifBlank { row.rawTvgId })
            putString("name", row.name)
            putString("logo", row.logo)
            putString("playlist_logo", row.logo)
            putString("epg_logo", effectiveEpgLogo)
            putString("group", row.groupTitle)
            putString("url", row.streamUrl)
            putString("stream_type", row.streamType)
          })
        }
        promise.resolve(Arguments.createMap().apply {
          putArray("channels", channels)
          putDouble("playlistEpoch", (database.getMeta("playlist_epoch")?.toLongOrNull() ?: 0L).toDouble())
          putDouble("playlistRefreshedAt", (database.getMeta("playlist_refreshed_at")?.toLongOrNull() ?: 0L).toDouble())
          putDouble("guideEpoch", effectiveGuideEpoch.toDouble())
          putDouble("guideRefreshedAt", effectiveGuideRefreshedAt.toDouble())
          putDouble("epgProgramCount", effectiveProgramCount.toDouble())
          putDouble("primaryGuideRefreshedAt", primaryGuideRefreshedAt.toDouble())
          putDouble("userGuideRefreshedAt", userGuideRefreshedAt.toDouble())
          putDouble("primaryEpgProgramCount", primaryProgramCount.toDouble())
          putDouble("userEpgProgramCount", userProgramCount.toDouble())
        })
      } catch (t: Throwable) {
        promise.reject("PLAYLIST_STORED_READ_FAILED", t.message ?: "Could not read stored playlist", t)
      }
    }
  }

  @ReactMethod
  fun touchPlaylistRefresh(playlistEpoch: Double, promise: Promise) {
    refreshExecutor.execute {
      try {
        val now = System.currentTimeMillis()
        database.setMeta("playlist_epoch", playlistEpoch.toLong().coerceAtLeast(0L).toString())
        database.setMeta("playlist_refreshed_at", now.toString())
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_PLAYLIST_TOUCH_FAILED", t.message ?: "Could not update playlist refresh clock", t)
      }
    }
  }

  @ReactMethod
  fun isPlaylistCurrent(contentFingerprint: String, promise: Promise) {
    queryExecutor.execute {
      try {
        promise.resolve(database.playlistFingerprintMatches(contentFingerprint.trim()))
      } catch (t: Throwable) {
        promise.reject("EPG_PLAYLIST_FINGERPRINT_FAILED", t.message ?: "Could not read playlist fingerprint", t)
      }
    }
  }

  @ReactMethod
  fun upsertPlaylistChannels(
    channels: ReadableArray,
    playlistEpoch: Double,
    contentFingerprint: String,
    promise: Promise,
  ) {
    refreshExecutor.execute {
      try {
        val rows = ArrayList<PlaylistChannelRow>(channels.size())
        for (i in 0 until channels.size()) {
          val map = channels.getMap(i) ?: continue
          val playlistId = map.getString("playlistId")?.trim().orEmpty()
          if (playlistId.isEmpty()) continue
          rows.add(
            PlaylistChannelRow(
              playlistId = playlistId,
              rawTvgId = map.getString("rawTvgId")?.trim().orEmpty(),
              name = map.getString("name")?.trim().orEmpty(),
              logo = map.getString("logo")?.trim().orEmpty(),
              groupTitle = map.getString("group")?.trim().orEmpty(),
              streamUrl = map.getString("url")?.trim().orEmpty(),
              streamType = map.getString("streamType")?.trim().orEmpty().ifEmpty { "unknown" },
              providerPosition = if (map.hasKey("position")) map.getDouble("position").toInt().coerceAtLeast(0) else i,
            )
          )
        }
        promise.resolve(
          // This is the combined enabled-playlist projection, not a provider
          // parse. All playlists may be explicitly disabled. Preserve their
          // saved catalogs while removing every row from the visible view.
          PlaylistSyncCoordinator.sync(database, rows, playlistEpoch.toLong(), contentFingerprint.trim(), allowEmptyProjection = true)
        )
      } catch (t: Throwable) {
        promise.reject("EPG_PLAYLIST_UPSERT_FAILED", t.message ?: "Could not upsert playlist channels", t)
      }
    }
  }

  @ReactMethod
  fun upsertPlaylistEpgMatches(matches: ReadableArray, guideEpoch: Double, promise: Promise) {
    refreshExecutor.execute {
      try {
        val rows = ArrayList<PlaylistEpgMatchRow>(matches.size())
        for (i in 0 until matches.size()) {
          val map = matches.getMap(i) ?: continue
          val playlistId = map.getString("playlistId")?.trim().orEmpty()
          if (playlistId.isEmpty()) continue
          rows.add(
            PlaylistEpgMatchRow(
              playlistId = playlistId,
              xmltvId = map.getString("xmltvId")?.trim().orEmpty(),
              logoXmltvId = map.getString("logoXmltvId")?.trim().orEmpty(),
              ambiguous = if (map.hasKey("ambiguous")) map.getBoolean("ambiguous") else false,
              matchPolicy = map.getString("matchPolicy")?.trim().orEmpty().ifEmpty { "full" },
              manual = if (map.hasKey("manual")) map.getBoolean("manual") else false,
            )
          )
        }
        promise.resolve(database.replacePlaylistEpgMatches(rows, guideEpoch.toLong()))
      } catch (t: Throwable) {
        promise.reject("EPG_MATCH_UPSERT_FAILED", t.message ?: "Could not upsert EPG matches", t)
      }
    }
  }

  @ReactMethod
  fun setGuideChannelBinding(channelId: String, xmltvId: String, promise: Promise) {
    refreshExecutor.execute {
      try {
        val channel = channelId.trim()
        val xmltv = xmltvId.trim()
        if (channel.isEmpty()) throw IllegalArgumentException("Channel id is empty")
        controlDao.setChannelBinding(USER_SOURCE_ID, channel, xmltv)
        promise.resolve(controlDao.channelBindingCount(USER_SOURCE_ID))
      } catch (t: Throwable) {
        promise.reject("EPG_BINDING_UPDATE_FAILED", t.message ?: "Could not update Guide channel assignment", t)
      }
    }
  }

  @ReactMethod
  fun listUserGuideChannels(query: String, offset: Double, limit: Double, promise: Promise) {
    queryExecutor.execute {
      try {
        val page = userDatabase.listDisplayNameAliases(
          query,
          offset.toInt().coerceAtLeast(0),
          limit.toInt().coerceIn(1, 100),
        )
        val rows = Arguments.createArray()
        for (row in page.rows) rows.pushMap(Arguments.createMap().apply {
          putString("id", row.channelId)
          putString("name", row.displayName)
        })
        promise.resolve(Arguments.createMap().apply {
          putInt("total", page.total)
          putArray("rows", rows)
        })
      } catch (t: Throwable) {
        promise.reject("USER_EPG_DIRECTORY_FAILED", t.message ?: "Could not read custom Guide channels", t)
      }
    }
  }

  @ReactMethod
  fun refreshUserGuide(url: String, promise: Promise) {
    refreshExecutor.execute {
      try {
        val sourceUrl = url.trim()
        if (sourceUrl.isEmpty()) throw IllegalArgumentException("Custom EPG URL is empty")
        val now = System.currentTimeMillis()
        val minStop = now - guideHistoryMs
        val maxStart = now + GUIDE_WINDOW_MS
        val channelLogos = LinkedHashMap<String, String>()
        val channelNames = LinkedHashMap<String, String>()
        val channelIdsWithPrograms = LinkedHashSet<String>()
        if (!userDatabase.ensureHealthy()) throw SQLiteException("Custom Guide database integrity check failed")
        userDatabase.assertRefreshStorageAvailable()
        val validators = EpgHttpValidators()
        val batches = streamProgramBatches(
          sourceUrl, minStop, maxStart, channelLogos, channelNames, channelIdsWithPrograms,
          validators, false, emptySet(), emptySet(), 0L, emptyMap(), userDatabase
        )
        userDatabase.replaceBatches(batches)
        val aliases = ArrayList<Triple<String, String, String>>(channelNames.size * 2)
        for ((channelId, displayName) in channelNames) {
          aliases.add(Triple(channelId, "display_name", displayName))
          aliases.add(Triple(channelId, "xmltv_id", channelId))
        }
        for (channelId in channelIdsWithPrograms) {
          if (!channelNames.containsKey(channelId)) aliases.add(Triple(channelId, "xmltv_id", channelId))
        }
        userDatabase.replaceChannelAliases(aliases)
        userDatabase.setMeta("guide_refreshed_at", now.toString())
        // Phase 9 UI reads the XMLTV directory through paged native queries.
        // Returning every channel name/id here duplicates a potentially huge
        // directory across the React Native bridge for no consumer.
        promise.resolve(Arguments.createMap().apply {
          putDouble("count", userDatabase.count().toDouble())
        })
      } catch (t: Throwable) {
        promise.reject("USER_EPG_REFRESH_FAILED", t.message ?: "Custom Guide refresh failed", t)
      }
    }
  }

  @ReactMethod
  fun clear(promise: Promise) {
    refreshExecutor.execute {
      try {
        database.clear()
        userDatabase.clear()
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("EPG_CLEAR_FAILED", t.message ?: "Could not clear native EPG cache", t)
      }
    }
  }

  private fun programToMap(program: NativeEpgProgram) = Arguments.createMap().apply {
    putString("channelId", program.channelId)
    putString("title", program.title)
    if (program.description != null) putString("description", program.description)
    else putNull("description")
    if (!program.category.isNullOrBlank()) putString("category", program.category)
    else putNull("category")
    putDouble("startMs", program.startMs.toDouble())
    putDouble("endMs", program.endMs.toDouble())
  }

  private fun groupPrograms(programmes: List<NativeEpgProgram>): WritableMap {
    val grouped = Arguments.createMap()
    val channelArrays = HashMap<String, WritableArray>()
    for (program in programmes) {
      val array = channelArrays.getOrPut(program.channelId) { Arguments.createArray() }
      array.pushMap(programToMap(program))
    }
    for ((channelId, array) in channelArrays) {
      grouped.putArray(channelId, array)
    }
    return grouped
  }

  private fun streamProgramBatches(
    url: String,
    minStop: Long,
    maxStart: Long,
    channelLogos: MutableMap<String, String>,
    channelNames: MutableMap<String, String>,
    channelIdsWithPrograms: MutableSet<String>,
    httpValidators: EpgHttpValidators,
    allowNotModified: Boolean,
    activeIds: Set<String>,
    activeNames: Set<String>,
    baseOffsetMs: Long,
    channelOffsetMs: Map<String, Long>,
    targetDatabase: EpgDatabase = database,
  ): Sequence<List<NativeEpgProgram>> = sequence {
    openPossiblyGzipped(url, httpValidators, allowNotModified, targetDatabase).use { input ->
      emitImportProgress("decompressing", 0.25)
      val parser = Xml.newPullParser()
      parser.setInput(input, "UTF-8")

      val batch = ArrayList<NativeEpgProgram>(BATCH_SIZE)
      var event = parser.eventType
      var metadataChannelId: String? = null
      var metadataChannelAccepted = false
      var metadataLogo: String? = null
      var channelId: String? = null
      var startMs = 0L
      var endMs = 0L
      var keepProgram = false
      var title = ""
      var description: String? = null
      var category: String? = null
      var rawProgrammeCount = 0L
      val acceptedChannelIds = HashSet<String>(activeIds)
      val acceptAllChannels = activeIds.isEmpty() && activeNames.isEmpty()

      while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
          XmlPullParser.START_TAG -> when (parser.name) {
            "channel" -> {
              metadataChannelId = parser.getAttributeValue(null, "id")?.trim()?.takeIf { it.isNotEmpty() }
              metadataChannelAccepted = acceptAllChannels || metadataChannelId?.lowercase()?.let { it in acceptedChannelIds } == true
              metadataLogo = null
            }
            "display-name" -> {
              val id = metadataChannelId
              if (!id.isNullOrBlank()) {
                val displayName = parser.nextText().trim()
                if (displayName.isNotEmpty()) {
                  if (acceptAllChannels || normalizeGuideKey(displayName) in activeNames) {
                    acceptedChannelIds.add(id.lowercase())
                    metadataChannelAccepted = true
                  }
                  if (metadataChannelAccepted && !channelNames.containsKey(id)) channelNames[id] = displayName
                }
              }
            }
            "icon" -> {
              val id = metadataChannelId
              val src = parser.getAttributeValue(null, "src")?.trim()
              if (!id.isNullOrBlank() && !src.isNullOrBlank()) {
                if (metadataChannelAccepted && !channelLogos.containsKey(id)) channelLogos[id] = src
                else metadataLogo = src
              }
            }
            "programme" -> {
              rawProgrammeCount += 1L
              if ((rawProgrammeCount and 0x1ffL) == 0L) {
                // A page change is not an import failure. Finish the staging
                // transaction at background priority and preserve normal reads.
                if (Thread.currentThread().isInterrupted) throw InterruptedException("Guide import stopped")
                Thread.yield()
              }
              if (rawProgrammeCount % PROGRESS_PROGRAMME_INTERVAL == 0L) {
                val workRatio = 1.0 - exp(-rawProgrammeCount.toDouble() / PROGRESS_PROGRAMME_SCALE)
                emitImportProgress("parsing", 0.3 + (0.55 * workRatio))
              }
              if (rawProgrammeCount > MAX_PROGRAMME_COUNT) {
                throw IllegalStateException(
                  "EPG contains more than $MAX_PROGRAMME_COUNT programmes; keeping last-good guide"
                )
              }
              channelId = parser.getAttributeValue(null, "channel")?.trim()
              val rawStartMs = parseXmltvTime(parser.getAttributeValue(null, "start"))
              val effectiveOffsetMs = baseOffsetMs + (channelId?.let(channelOffsetMs::get) ?: 0L)
              startMs = if (rawStartMs > 0L) rawStartMs + effectiveOffsetMs else 0L
              // Match JS resolveXmltvStop: missing/invalid/absurd stop → +30 minutes.
              // Next-program inference runs once on staging after ingest.
              val rawStopMs = parseXmltvTime(parser.getAttributeValue(null, "stop"))
              val parsedStop = if (rawStopMs > 0L) rawStopMs + effectiveOffsetMs else 0L
              endMs = resolveProgrammeStop(startMs, parsedStop)
              keepProgram =
                !channelId.isNullOrBlank() &&
                  (acceptAllChannels || channelId!!.lowercase() in acceptedChannelIds) &&
                  startMs > 0L &&
                  endMs > startMs &&
                  endMs >= minStop &&
                  startMs <= maxStart
              title = ""
              description = null
              category = null
            }
            "title" -> if (keepProgram) title = parser.nextText().trim()
            "desc" -> if (keepProgram) description = parser.nextText().trim().ifEmpty { null }
            "category" -> if (keepProgram && category.isNullOrBlank()) {
              category = parser.nextText().trim().ifEmpty { null }
            }
          }
          XmlPullParser.END_TAG -> when (parser.name) {
            "channel" -> {
              val id = metadataChannelId
              if (metadataChannelAccepted && !id.isNullOrBlank() && !metadataLogo.isNullOrBlank() && !channelLogos.containsKey(id)) {
                channelLogos[id] = metadataLogo!!
              }
              metadataChannelId = null
              metadataChannelAccepted = false
              metadataLogo = null
            }
            "programme" -> {
              val id = channelId
              if (keepProgram && !id.isNullOrBlank()) {
                channelIdsWithPrograms.add(id)
                batch.add(
                  NativeEpgProgram(
                    channelId = id,
                    title = title.ifBlank { "No Information" },
                    description = description,
                    category = category,
                    startMs = startMs,
                    endMs = endMs,
                  )
                )
                if (batch.size >= BATCH_SIZE) {
                  yield(ArrayList(batch))
                  batch.clear()
                }
              }
              channelId = null
              keepProgram = false
            }
          }
        }
        event = parser.next()
      }
      emitImportProgress("indexing", 0.88)
      if (batch.isNotEmpty()) yield(ArrayList(batch))
    }
  }

  @ReactMethod
  fun searchProgrammes(query: String, limit: Double, promise: Promise) {
    queryExecutor.execute {
      try {
        val safeLimit = limit.toInt().coerceIn(1, 80)
        val primaryEnabled = controlDao.source(DEFAULT_PLAYLIST_ID)?.enabled ?: true
        val userSource = controlDao.source(USER_SOURCE_ID)
        val userEnabled = userSource?.enabled == true && userSource.url.isNotBlank()
        val rows = ArrayList<NativeEpgProgram>()
        val bindings = if (userEnabled) controlDao.effectiveBindings(USER_SOURCE_ID) else emptyList()
        val excludedPrimaryXmltvIds = if (primaryEnabled && bindings.isNotEmpty()) {
          database.matchedXmltvIdsForPlaylistIds(bindings.map { it.channelId })
        } else emptySet()
        if (primaryEnabled) {
          rows.addAll(database.searchProgrammes(query, safeLimit, excludedPrimaryXmltvIds))
        }
        if (userEnabled && rows.size < safeLimit) {
          if (bindings.isNotEmpty()) {
            val playlistIdsByXmltv = HashMap<String, MutableList<String>>()
            for (binding in bindings) playlistIdsByXmltv.getOrPut(binding.xmltvId) { ArrayList() }.add(binding.channelId)
            for (program in userDatabase.searchProgrammes(query, safeLimit - rows.size)) {
              val targets = playlistIdsByXmltv[program.channelId] ?: continue
              for (playlistId in targets) {
                rows.add(program.copy(channelId = playlistId))
                if (rows.size >= safeLimit) break
              }
              if (rows.size >= safeLimit) break
            }
          }
        }
        val result = Arguments.createArray()
        for (program in rows.take(safeLimit)) result.pushMap(programToMap(program))
        promise.resolve(result)
      } catch (t: Throwable) {
        promise.reject("EPG_SEARCH_FAILED", t.message ?: "Could not search programmes", t)
      }
    }
  }

  private fun normalizeGuideKey(value: String): String =
    value.lowercase().filter { it.isLetterOrDigit() }

  private fun openPossiblyGzipped(
    urlString: String,
    validators: EpgHttpValidators,
    allowNotModified: Boolean,
    targetDatabase: EpgDatabase = database,
  ): InputStream {
    val sourceHash = sha256(urlString)
    validators.sourceHash = sourceHash
    val canUseValidators =
      allowNotModified && targetDatabase.count() > 0L && targetDatabase.getMeta(HTTP_SOURCE_HASH_KEY) == sourceHash

    var currentUrl = URL(urlString)
    var redirects = 0
    while (true) {
      val scheme = currentUrl.protocol.lowercase(Locale.US)
      if (scheme != "http" && scheme != "https") {
        throw IllegalStateException("EPG redirect used unsupported scheme: $scheme")
      }

      val connection = currentUrl.openConnection() as HttpURLConnection
      connection.connectTimeout = 15_000
      connection.readTimeout = 45_000
      connection.instanceFollowRedirects = false
      connection.setRequestProperty("User-Agent", "TiviMate/5.1.6 (Linux; Android TV)")
      connection.setRequestProperty("Accept", "*/*")
      connection.setRequestProperty("Accept-Encoding", "gzip")
      if (canUseValidators) {
        targetDatabase.getMeta(HTTP_ETAG_KEY)?.takeIf { it.isNotBlank() }?.let {
          connection.setRequestProperty("If-None-Match", it)
        }
        targetDatabase.getMeta(HTTP_LAST_MODIFIED_KEY)?.takeIf { it.isNotBlank() }?.let {
          connection.setRequestProperty("If-Modified-Since", it)
        }
      }
      val status = try {
        connection.connect()
        connection.responseCode
      } catch (t: Throwable) {
        connection.disconnect()
        throw t
      }
      if (isHttpRedirect(status)) {
        val location = connection.getHeaderField("Location")?.trim().orEmpty()
        connection.disconnect()
        if (location.isEmpty()) throw IllegalStateException("EPG HTTP $status redirect missing Location")
        redirects += 1
        if (redirects > MAX_HTTP_REDIRECTS) {
          throw IllegalStateException("EPG redirect limit exceeded ($MAX_HTTP_REDIRECTS)")
        }
        currentUrl = URL(currentUrl, location)
        continue
      }

      if (status == HttpURLConnection.HTTP_NOT_MODIFIED && canUseValidators) {
        connection.disconnect()
        throw EpgNotModifiedException()
      }
      if (status !in 200..299) {
        connection.disconnect()
        throw IllegalStateException("EPG HTTP $status")
      }
      validators.etag = connection.getHeaderField("ETag")?.trim().orEmpty()
      validators.lastModified = connection.getHeaderField("Last-Modified")?.trim().orEmpty()
      val declaredLength = connection.contentLengthLong
      if (declaredLength > MAX_COMPRESSED_EPG_BYTES) {
        connection.disconnect()
        throw IllegalStateException(
          "EPG download exceeds the ${MAX_COMPRESSED_EPG_BYTES / (1024L * 1024L)} MiB compressed safety limit"
        )
      }
      try {
        // The connection is already open here. Keep the storage gate inside the
        // disconnect guard so a low-space refusal cannot leak a provider socket.
        targetDatabase.assertRefreshStorageAvailable(declaredLength)
        val connectionStream = object : FilterInputStream(connection.inputStream) {
          override fun close() {
            try {
              super.close()
            } finally {
              connection.disconnect()
            }
          }
        }
        val networkStream = BoundedInputStream(
          connectionStream,
          MAX_COMPRESSED_EPG_BYTES,
          "compressed EPG download",
        ) { bytesRead ->
          val fraction = if (declaredLength > 0L) {
            bytesRead.toDouble() / declaredLength.toDouble()
          } else {
            1.0 - exp(-bytesRead.toDouble() / UNKNOWN_LENGTH_PROGRESS_SCALE_BYTES)
          }
          emitImportProgress("downloading", 0.2 + (0.28 * fraction.coerceIn(0.0, 1.0)))
        }
        val buffered = BufferedInputStream(networkStream, NETWORK_BUFFER_SIZE)
        buffered.mark(2)
        val b1 = buffered.read()
        val b2 = buffered.read()
        buffered.reset()

        val decoded = if (b1 == 0x1f && b2 == 0x8b) {
          GZIPInputStream(buffered, NETWORK_BUFFER_SIZE)
        } else {
          buffered
        }
        return BoundedInputStream(decoded, MAX_DECOMPRESSED_EPG_BYTES, "decompressed EPG data")
      } catch (t: Throwable) {
        connection.disconnect()
        throw t
      }
    }
  }

  private fun isHttpRedirect(status: Int): Boolean =
    status == HttpURLConnection.HTTP_MOVED_PERM ||
      status == HttpURLConnection.HTTP_MOVED_TEMP ||
      status == HttpURLConnection.HTTP_SEE_OTHER ||
      status == 307 ||
      status == 308

  private fun sha256(value: String): String {
    return MessageDigest.getInstance("SHA-256")
      .digest(value.toByteArray(Charsets.UTF_8))
      .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  private fun resolveProgrammeStop(startMs: Long, parsedStopMs: Long): Long {
    if (startMs <= 0L) return 0L
    if (
      parsedStopMs > startMs &&
      parsedStopMs - startMs <= MAX_PROGRAMME_DURATION_MS
    ) {
      return parsedStopMs
    }
    return startMs + DEFAULT_PROGRAMME_DURATION_MS
  }

  private fun parseXmltvTime(raw: String?): Long {
    if (raw == null) return 0L
    val value = raw.trim()
    if (value.length < 14) return 0L
    return try {
      fun digits(offset: Int, count: Int): Int {
        var result = 0
        for (i in offset until offset + count) {
          val digit = value[i].code - '0'.code
          if (digit !in 0..9) throw NumberFormatException("Invalid XMLTV time")
          result = result * 10 + digit
        }
        return result
      }

      val year = digits(0, 4)
      val month = digits(4, 2)
      val day = digits(6, 2)
      val hour = digits(8, 2)
      val minute = digits(10, 2)
      val second = digits(12, 2)
      if (month !in 1..12 || day !in 1..31 || hour !in 0..23 || minute !in 0..59 || second !in 0..59) {
        return 0L
      }

      var y = year.toLong()
      val m = month.toLong()
      val d = day.toLong()
      y -= if (m <= 2L) 1L else 0L
      val era = Math.floorDiv(y, 400L)
      val yoe = y - era * 400L
      val mp = m + if (m > 2L) -3L else 9L
      val doy = (153L * mp + 2L) / 5L + d - 1L
      val doe = yoe * 365L + yoe / 4L - yoe / 100L + doy
      val epochDay = era * 146097L + doe - 719468L
      var millis =
        epochDay * 86_400_000L +
          hour * 3_600_000L +
          minute * 60_000L +
          second * 1_000L

      var i = 14
      while (i < value.length && value[i].isWhitespace()) i++
      if (i + 4 < value.length && (value[i] == '+' || value[i] == '-')) {
        val sign = if (value[i] == '-') -1 else 1
        val offsetHours = digits(i + 1, 2)
        val offsetMinutes = digits(i + 3, 2)
        if (offsetHours <= 23 && offsetMinutes <= 59) {
          millis -= sign * (offsetHours * 60L + offsetMinutes) * 60_000L
        }
      }
      millis
    } catch (_: Throwable) {
      0L
    }
  }

  override fun invalidate() {
    refreshExecutor.shutdownNow()
    playlistExecutor.shutdownNow()
    queryExecutor.shutdownNow()
    // `database` is the shared primary EpgDatabase instance (EpgRamModule and
    // NativeGuideView may still be using it) — never close it here.
    CustomEpgStoreRegistry.closeAll()
    super.invalidate()
  }

  private fun isCatastrophicDatabaseFailure(failure: Throwable): Boolean {
    var current: Throwable? = failure
    while (current != null) {
      if (current is SQLiteException) return true
      val message = current.message.orEmpty().lowercase()
      if (message.contains("database disk image is malformed") ||
        message.contains("database or disk is full") ||
        message.contains("disk i/o error") ||
        message.contains("database is locked")) return true
      current = current.cause
    }
    return false
  }

  companion object {
    private class BoundedInputStream(
      input: InputStream,
      private val maxBytes: Long,
      private val label: String,
      private val onBytesRead: ((Long) -> Unit)? = null,
    ) : FilterInputStream(input) {
      private var bytesRead = 0L
      private var lastReportedBytes = 0L

      private fun account(count: Int): Int {
        if (count <= 0) return count
        bytesRead += count.toLong()
        if (bytesRead > maxBytes) {
          throw IllegalStateException(
            "$label exceeds the ${maxBytes / (1024L * 1024L)} MiB safety limit"
          )
        }
        if (bytesRead - lastReportedBytes >= PROGRESS_BYTE_INTERVAL) {
          lastReportedBytes = bytesRead
          onBytesRead?.invoke(bytesRead)
        }
        return count
      }

      override fun read(): Int {
        val value = super.read()
        if (value >= 0) account(1)
        return value
      }

      override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        return account(super.read(buffer, offset, length))
      }

      override fun skip(count: Long): Long {
        val skipped = super.skip(count)
        if (skipped > 0L) {
          bytesRead += skipped
          if (bytesRead > maxBytes) {
            throw IllegalStateException(
              "$label exceeds the ${maxBytes / (1024L * 1024L)} MiB safety limit"
            )
          }
        }
        return skipped
      }
    }

    private class EpgNotModifiedException : Exception()
    private data class EpgHttpValidators(
      var sourceHash: String = "",
      var etag: String = "",
      var lastModified: String = "",
    )

    private const val HTTP_SOURCE_HASH_KEY = "epg_http_source_hash"
    private const val DEFAULT_PLAYLIST_ID = "default"
    private const val USER_SOURCE_ID = "user"
    private const val MAX_USER_BINDINGS = 10_000
    private const val HTTP_ETAG_KEY = "epg_http_etag"
    private const val HTTP_LAST_MODIFIED_KEY = "epg_http_last_modified"
    private const val DB_BLACKOUT_UNTIL_KEY = "epg_database_blackout_until"
    private const val DB_RECOVERY_PREFS = "charm_epg_recovery"
    private const val DB_BLACKOUT_MS = 60L * 60L * 1000L
    private const val BATCH_SIZE = 1000
    private const val NETWORK_BUFFER_SIZE = 64 * 1024
    private const val MAX_HTTP_REDIRECTS = 6
    private const val MAX_COMPRESSED_EPG_BYTES = 256L * 1024L * 1024L
    private const val MAX_DECOMPRESSED_EPG_BYTES = 1024L * 1024L * 1024L
    private const val MAX_PROGRAMME_COUNT = 2_000_000L
    private const val PROGRESS_PROGRAMME_INTERVAL = 5_000L
    private const val PROGRESS_PROGRAMME_SCALE = 50_000.0
    private const val PROGRESS_BYTE_INTERVAL = 512L * 1024L
    private const val UNKNOWN_LENGTH_PROGRESS_SCALE_BYTES = 16.0 * 1024.0 * 1024.0
    private const val DEFAULT_GUIDE_HISTORY_MS = 7L * 24L * 60L * 60L * 1000L
    // TiViMate-style bounded active-window retention: keep at most the largest
    // user-selectable Guide horizon in the native XMLTV index. The UI defaults
    // to 12h and can opt into 24h; retaining 72h here only increases parse/disk
    // work and does not improve the visible Guide.
    private const val GUIDE_WINDOW_MS = 24L * 60L * 60L * 1000L
    private const val MAX_QUERY_WINDOW_MS = 24L * 60L * 60L * 1000L
    private const val DEFAULT_PROGRAMME_DURATION_MS = 30L * 60L * 1000L
    private const val MAX_PROGRAMME_DURATION_MS = 24L * 60L * 60L * 1000L
    /** Only vacuum after a large expiry purge — never on every refresh. */
    private const val MIN_VACUUM_DELETED_ROWS = 5_000
  }
}
