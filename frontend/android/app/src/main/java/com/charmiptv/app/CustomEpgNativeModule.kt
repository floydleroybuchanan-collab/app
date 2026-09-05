package com.charmiptv.app

import android.content.Context
import android.util.Xml
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

class CustomEpgNativeModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val userDatabase = CustomEpgStoreRegistry.database(reactContext, USER_SOURCE_ID)
  private val controlDao = EpgControlDatabase.get(reactContext).dao()
  private val executor = Executors.newSingleThreadExecutor { task ->
    Thread({ android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); task.run() }, "charm-custom-epg-import")
  }
  // Directory, health and search reads must not wait behind network/XML import.
  private val queryExecutor = Executors.newFixedThreadPool(2)
  private val policyPrefs = reactContext.getSharedPreferences(POLICY_PREFS, Context.MODE_PRIVATE)

  override fun getName(): String = "CharmCustomEpg"

  @ReactMethod fun replaceAutomaticBindings(rows: ReadableArray, promise: Promise) { executor.execute {
    try {
      val bindings = ArrayList<EpgAutomaticBindingEntity>(rows.size())
      val directories = HashMap<String, Set<String>>()
      val names = HashMap<String, Map<String, String>>()
      val callsigns = HashMap<String, Map<String, String>>()
      val boundChannels = HashSet<String>()
      val logoKeys = HashMap<String, Map<String, String>>()
      val fuzzyKeys = HashMap<String, Map<String, String>>()
      for (index in 0 until rows.size()) {
        val row = rows.getMap(index) ?: continue
        val channel = row.getString("channelId").orEmpty()
        val xmltv = row.getString("xmltvId").orEmpty()
        val channelName = if (row.hasKey("channelName")) row.getString("channelName").orEmpty() else ""
        val channelLogo = if (row.hasKey("channelLogo")) row.getString("channelLogo").orEmpty() else ""
        val candidates = row.getArray("sourceIds") ?: continue
        var selected: String? = null
        var selectedXmltv = xmltv
        var selectedReason = "exact_id"
        var pending: String? = null
        for (at in 0 until candidates.size()) {
          val source = CustomEpgStoreRegistry.normalizeSourceId(candidates.getString(at).orEmpty())
          val ids = directories.getOrPut(source) { CustomEpgStoreRegistry.database(reactContext, source).guideDirectoryIds() }
          if (xmltv in ids) { selected = source; selectedReason = "exact_tvg_id"; break }
          val nameKey = EpgDatabase.normalizeKey(channelName)
          val nameMatch = if (nameKey.isNotEmpty()) names.getOrPut(source) { CustomEpgStoreRegistry.database(reactContext, source).guideDirectoryByUniqueName() }[nameKey] else null
          if (!nameMatch.isNullOrBlank()) {
            selected = source; selectedXmltv = nameMatch; selectedReason = "unique_display_name"
            break
          }
          val directoryNames = names.getOrPut(source) { CustomEpgStoreRegistry.database(reactContext, source).guideDirectoryByUniqueName() }
          val callKey = callsignKey(nameKey)
          val callsignMatch = if (callKey.isNotEmpty()) callsigns.getOrPut(source) { uniqueDerivedIndex(directoryNames, ::callsignKey) }[callKey] else null
          if (!callsignMatch.isNullOrBlank()) {
            selected = source; selectedXmltv = callsignMatch; selectedReason = "guarded_callsign"
            break
          }
          val logoKey = logoMatchKey(channelLogo)
          val logoMatch = if (logoKey.isNotEmpty()) logoKeys.getOrPut(source) {
            val db = CustomEpgStoreRegistry.database(reactContext, source)
            uniqueDerivedIndex(db.iconAliases(ids).entries.associate { it.value to it.key }, ::logoMatchKey)
          }[logoKey] else null
          if (!logoMatch.isNullOrBlank()) {
            selected = source; selectedXmltv = logoMatch; selectedReason = "unique_logo"
            break
          }
          val fuzzyMatch = if (nameKey.length >= 6) fuzzyLookup(fuzzyKeys.getOrPut(source) { fuzzyDeletionIndex(directoryNames) }, nameKey) else null
          if (!fuzzyMatch.isNullOrBlank()) {
            selected = source; selectedXmltv = fuzzyMatch; selectedReason = "guarded_fuzzy_name"
            break
          }
          if (ids.isEmpty() && pending == null) pending = source
        }
        val source = selected ?: pending
        if (source != null && channel.isNotBlank() && selectedXmltv.isNotBlank() && boundChannels.add(channel)) bindings.add(EpgAutomaticBindingEntity(channel, source, selectedXmltv, if (selected == null) "pending_directory" else selectedReason))
      }
      controlDao.replaceAutomaticBindings(bindings)
      promise.resolve(true)
    } catch (_: Throwable) { promise.reject("AUTOMATIC_BINDINGS_FAILED", "Could not save playlist Guide associations") }
  }}

  @ReactMethod fun setRetentionDays(pastDays: Double, promise: Promise) {
    try {
      val normalized = pastDays.toInt().let { if (it == 1 || it == 3 || it == 7 || it == 14) it else 7 }
      policyPrefs.edit().putInt(POLICY_PAST_DAYS, normalized).apply(); promise.resolve(true)
    } catch (t: Throwable) { promise.reject("CUSTOM_EPG_POLICY_FAILED", t.message ?: "Could not save custom EPG retention", t) }
  }
  private fun retentionDays(): Int = policyPrefs.getInt(POLICY_PAST_DAYS, 7).let { if (it == 1 || it == 3 || it == 7 || it == 14) it else 7 }

  @ReactMethod fun setGuideChannelBinding(channelId: String, xmltvId: String, promise: Promise) { executor.execute {
    try {
      val channel = channelId.trim(); if (channel.isEmpty()) throw IllegalArgumentException("Channel id is empty")
      controlDao.setExclusiveUserChannelBinding(USER_SOURCE_ID, channel, xmltvId.trim()); promise.resolve(controlDao.channelBindingCount(USER_SOURCE_ID))
    } catch (t: Throwable) { promise.reject("CUSTOM_EPG_BINDING_FAILED", t.message ?: "Could not update custom Guide assignment", t) }
  }}

  @ReactMethod fun listUserGuideChannels(query: String, offset: Double, limit: Double, promise: Promise) { queryExecutor.execute {
    try {
      val page = userDatabase.listDisplayNameAliases(query, offset.toInt().coerceAtLeast(0), limit.toInt().coerceIn(1, 100))
      val rows = Arguments.createArray(); for (row in page.rows) rows.pushMap(Arguments.createMap().apply { putString("id", row.channelId); putString("name", row.displayName) })
      promise.resolve(Arguments.createMap().apply { putInt("total", page.total); putArray("rows", rows) })
    } catch (t: Throwable) { promise.reject("CUSTOM_EPG_DIRECTORY_FAILED", t.message ?: "Could not read custom Guide channels", t) }
  }}

  @ReactMethod fun listSourceGuideChannels(sourceId: String, query: String, offset: Double, limit: Double, promise: Promise) { queryExecutor.execute {
    try {
      val page = CustomEpgStoreRegistry.database(reactContext, sourceId).listDisplayNameAliases(query, offset.toInt().coerceAtLeast(0), limit.toInt().coerceIn(1, 100))
      val rows = Arguments.createArray(); for (row in page.rows) rows.pushMap(Arguments.createMap().apply { putString("id", row.channelId); putString("name", row.displayName) })
      promise.resolve(Arguments.createMap().apply { putInt("total", page.total); putArray("rows", rows) })
    } catch (t: Throwable) { promise.reject("CUSTOM_EPG_DIRECTORY_FAILED", t.message ?: "Could not read custom Guide channels", t) }
  }}

  @ReactMethod fun searchSourceProgrammes(sourceId: String, query: String, limit: Double, promise: Promise) { queryExecutor.execute {
    try {
      val source = CustomEpgStoreRegistry.normalizeSourceId(sourceId)
      val safeLimit = limit.toInt().coerceIn(1, 80)
      val bindings = controlDao.effectiveBindings(source)
      val result = Arguments.createArray()
      if (bindings.isNotEmpty()) {
        val playlistIdsByXmltv = HashMap<String, MutableList<String>>()
        for (binding in bindings) playlistIdsByXmltv.getOrPut(binding.xmltvId) { ArrayList() }.add(binding.channelId)
        val db = CustomEpgStoreRegistry.database(reactContext, source)
        for (program in db.searchProgrammes(query, safeLimit)) {
          val targets = playlistIdsByXmltv[program.channelId] ?: continue
          for (playlistId in targets) {
            result.pushMap(programToMap(program.copy(channelId = playlistId)))
            if (result.size() >= safeLimit) break
          }
          if (result.size() >= safeLimit) break
        }
      }
      promise.resolve(result)
    } catch (t: Throwable) { promise.reject("CUSTOM_EPG_SEARCH_FAILED", t.message ?: "Could not search custom EPG", t) }
  }}

  @ReactMethod fun clearUserGuide(promise: Promise) { executor.execute { try { userDatabase.clear(); promise.resolve(true) } catch (t: Throwable) { promise.reject("CUSTOM_EPG_CLEAR_FAILED", t.message ?: "Could not clear custom Guide data", t) } } }
  @ReactMethod fun clearSourceGuide(sourceId: String, promise: Promise) { executor.execute { try { CustomEpgStoreRegistry.database(reactContext, sourceId).clear(); promise.resolve(true) } catch (t: Throwable) { promise.reject("CUSTOM_EPG_CLEAR_FAILED", t.message ?: "Could not clear custom Guide data", t) } } }

  @ReactMethod fun setSourceChannelBinding(sourceId: String, channelId: String, xmltvId: String, promise: Promise) { executor.execute {
    try {
      val source = CustomEpgStoreRegistry.normalizeSourceId(sourceId); val channel = channelId.trim(); if (channel.isEmpty()) throw IllegalArgumentException("Channel id is empty")
      controlDao.setExclusiveUserChannelBinding(source, channel, xmltvId.trim()); promise.resolve(controlDao.channelBindingCount(source))
    } catch (t: Throwable) { promise.reject("CUSTOM_EPG_BINDING_FAILED", t.message ?: "Could not update custom Guide assignment", t) }
  }}

  @ReactMethod fun refreshAssociatedSourceGuide(sourceId: String, url: String, ids: ReadableArray, promise: Promise) { executor.execute {
    val candidates = LinkedHashSet<String>()
    for (index in 0 until ids.size()) ids.getString(index)?.takeIf { it.isNotBlank() }?.let(candidates::add)
    refreshSourceGuideInternal(sourceId, url, promise, candidates)
  }}

  @ReactMethod fun refreshUserGuide(url: String, promise: Promise) { executor.execute { refreshSourceGuideInternal(USER_SOURCE_ID, url, promise) } }
  @ReactMethod fun refreshSourceGuide(sourceId: String, url: String, promise: Promise) { executor.execute { refreshSourceGuideInternal(sourceId, url, promise) } }

  @ReactMethod fun getPlaylistGuideHealth(groups: ReadableArray, promise: Promise) { queryExecutor.execute {
    try {
      // EpgNativeModule stores the managed source under `default`. Keep health
      // reporting on the same identifier used by imports and Guide queries.
      val primaryEnabled = controlDao.source("default")?.enabled ?: true
      val primaryMatches = EpgDatabase.shared(reactContext).activePlaylistChannels().associate { it.playlistId to it.matchedXmltvId }
      val sources = ArrayList<String>().apply {
        controlDao.source(USER_SOURCE_ID)?.takeIf { it.enabled && it.url.isNotBlank() }?.let { add(USER_SOURCE_ID) }
        addAll(controlDao.userSources().filter { it.enabled && it.url.isNotBlank() }.map { it.playlistId })
      }
      val manualBySource = sources.associateWith { source -> controlDao.allChannelBindings(source).associateBy { it.channelId } }
      val result = Arguments.createArray()
      for (index in 0 until groups.size()) {
        val group = groups.getMap(index) ?: continue
        val playlistId = group.getString("playlistId").orEmpty()
        val name = group.getString("name").orEmpty()
        val input = group.getArray("channelIds")
        val ids = ArrayList<String>()
        if (input != null) for (at in 0 until input.size()) input.getString(at)?.takeIf { it.isNotBlank() }?.let(ids::add)
        val custom = HashMap<String, EpgChannelBindingEntity>()
        for (source in sources) for (chunk in ids.chunked(400)) {
          for (binding in controlDao.effectiveBindingsForChannels(source, chunk)) custom.putIfAbsent(binding.channelId, binding)
        }
        var matched = 0
        var customMatched = 0
        var primaryMatched = 0
        var indexedChannels = 0
        val sourceIds = LinkedHashSet<String>()
        val methods = LinkedHashMap<String, Int>()
        val explanations = Arguments.createArray()
        val unmatchedIds = Arguments.createArray()
        val automatic = ids.chunked(400).flatMap(controlDao::automaticBindingsForChannels).associateBy { it.channelId }
        val programmeIdsBySource = HashMap<String, Set<String>>()
        for (source in sources) {
          val xmltvIds = custom.values.filter { it.playlistId == source }.map { it.xmltvId }
          if (xmltvIds.isNotEmpty()) programmeIdsBySource[source] = CustomEpgStoreRegistry.database(reactContext, source).programmeChannelIds(xmltvIds)
        }
        val primaryProgrammeIds = EpgDatabase.shared(reactContext).programmeChannelIds(ids.mapNotNull(primaryMatches::get))
        for (id in ids) {
          val binding = custom[id]
          if (binding != null && binding.xmltvId.isNotBlank()) {
            matched += 1; customMatched += 1; sourceIds.add(binding.playlistId)
            val manual = manualBySource[binding.playlistId]?.containsKey(id) == true
            val reason = if (manual) "manual_override" else automatic[id]?.matchReason ?: "automatic"
            methods[reason] = (methods[reason] ?: 0) + 1
            val hasPrograms = binding.xmltvId in programmeIdsBySource[binding.playlistId].orEmpty()
            if (hasPrograms) indexedChannels += 1
            if (explanations.size() < 80) explanations.pushMap(Arguments.createMap().apply {
              putString("channelId", id); putString("sourceId", binding.playlistId); putString("xmltvId", binding.xmltvId)
              putString("reason", reason); putBoolean("hasPrograms", hasPrograms)
            })
          } else if (primaryEnabled && !primaryMatches[id].isNullOrBlank()) {
            matched += 1; primaryMatched += 1; sourceIds.add("primary")
            methods["primary_match"] = (methods["primary_match"] ?: 0) + 1
            val xmltvId = primaryMatches[id].orEmpty(); val hasPrograms = xmltvId in primaryProgrammeIds
            if (hasPrograms) indexedChannels += 1
            if (explanations.size() < 80) explanations.pushMap(Arguments.createMap().apply {
              putString("channelId", id); putString("sourceId", "primary"); putString("xmltvId", xmltvId)
              putString("reason", "primary_match"); putBoolean("hasPrograms", hasPrograms)
            })
          } else if (unmatchedIds.size() < 80) {
            unmatchedIds.pushString(id)
          }
        }
        result.pushMap(Arguments.createMap().apply {
          putString("playlistId", playlistId); putString("name", name); putInt("channels", ids.size)
          putInt("matched", matched); putInt("unmatched", (ids.size - matched).coerceAtLeast(0))
          putInt("primaryMatched", primaryMatched); putInt("customMatched", customMatched)
          putInt("indexedChannels", indexedChannels)
          putMap("matchMethods", Arguments.createMap().apply { methods.forEach { (key, count) -> putInt(key, count) } })
          putArray("matchExplanations", explanations); putArray("unmatchedChannelIds", unmatchedIds)
          putArray("sourceIds", Arguments.createArray().apply { sourceIds.forEach(::pushString) })
        })
      }
      promise.resolve(result)
    } catch (t: Throwable) { promise.reject("PLAYLIST_GUIDE_HEALTH_FAILED", t.message ?: "Could not read per-playlist Guide health", t) }
  }}

  private fun callsignKey(value: String): String {
    val normalized = EpgDatabase.normalizeKey(value)
      .removePrefix("us").removePrefix("ca")
      .replace(Regex("(?:fhd|uhd|hd|sd|tv|east|west)$"), "")
    return normalized.takeIf { it.length in 3..10 && it.any(Char::isLetter) }.orEmpty()
  }

  private fun logoMatchKey(value: String): String {
    val file = value.substringBefore('?').substringAfterLast('/').substringBeforeLast('.')
    return EpgDatabase.normalizeKey(file).takeIf { it.length >= 4 }.orEmpty()
  }

  private fun uniqueDerivedIndex(values: Map<String, String>, transform: (String) -> String): Map<String, String> {
    val out = HashMap<String, String>()
    val ambiguous = HashSet<String>()
    for ((raw, id) in values) {
      val key = transform(raw)
      if (key.isEmpty() || key in ambiguous) continue
      val old = out.putIfAbsent(key, id)
      if (old != null && old != id) { out.remove(key); ambiguous.add(key) }
    }
    return out
  }

  private fun fuzzyDeletionIndex(values: Map<String, String>): Map<String, String> {
    val out = HashMap<String, String>()
    val ambiguous = HashSet<String>()
    for ((name, id) in values) {
      if (name.length < 6) continue
      val signatures = LinkedHashSet<String>()
      signatures.add(name)
      for (index in name.indices) signatures.add(name.removeRange(index, index + 1))
      for (signature in signatures) {
        if (signature in ambiguous) continue
        val old = out.putIfAbsent(signature, id)
        if (old != null && old != id) { out.remove(signature); ambiguous.add(signature) }
      }
    }
    return out
  }

  private fun fuzzyLookup(index: Map<String, String>, value: String): String? {
    val hits = LinkedHashSet<String>()
    index[value]?.let(hits::add)
    for (at in value.indices) index[value.removeRange(at, at + 1)]?.let(hits::add)
    return hits.singleOrNull()
  }

  private fun programToMap(program: NativeEpgProgram) = Arguments.createMap().apply {
    putString("channelId", program.channelId); putString("title", program.title)
    if (program.description != null) putString("description", program.description) else putNull("description")
    if (!program.category.isNullOrBlank()) putString("category", program.category) else putNull("category")
    putDouble("startMs", program.startMs.toDouble()); putDouble("endMs", program.endMs.toDouble())
  }

  private fun refreshSourceGuideInternal(rawSourceId: String, url: String, promise: Promise, candidates: Set<String> = emptySet()) {
    val sourceId = CustomEpgStoreRegistry.normalizeSourceId(rawSourceId)
    val startedMs = System.currentTimeMillis()
    val previousState = runCatching { controlDao.importState(sourceId) }.getOrNull()
    val attempt = (previousState?.attemptCount ?: 0) + 1
    val historyId = runCatching { controlDao.addUpdateHistory(EpgUpdateHistoryEntity(sourceId = sourceId, kind = "epg", state = "running", trigger = "manual", attempt = attempt, startedAtSeconds = startedMs / 1000L)) }.getOrDefault(0L)
    runCatching { controlDao.putImportState(EpgImportStateEntity(playlistId = sourceId, lastAttemptSeconds = startedMs / 1000L, lastSuccessSeconds = previousState?.lastSuccessSeconds ?: 0L, state = "running", attemptCount = attempt, lastProgrammeCount = previousState?.lastProgrammeCount ?: 0L, lastTrigger = "manual")) }
    try {
      val targetDatabase = CustomEpgStoreRegistry.database(reactContext, sourceId)
      val sourceUrl = url.trim(); if (sourceUrl.isEmpty()) throw IllegalArgumentException("Custom EPG URL is empty")
      if (!targetDatabase.ensureHealthy()) throw IllegalStateException("Custom Guide database integrity check failed"); targetDatabase.assertRefreshStorageAvailable()
      val effectiveBindings = controlDao.effectiveBindings(sourceId)
      val activeXmltvIds = LinkedHashSet<String>(candidates); for (binding in effectiveBindings) binding.xmltvId.trim().takeIf { it.isNotEmpty() }?.let(activeXmltvIds::add)
      val sourceConfig = controlDao.source(sourceId)
      val baseOffsetMs = ((sourceConfig?.serverOffsetMinutes ?: 0) + (sourceConfig?.playlistOffsetMinutes ?: 0) + GuideTimingPolicy.globalOffsetMinutes(reactContext)).toLong() * 60_000L
      val configuredOffsets = controlDao.channelOffsets(sourceId).associate { it.channelId to it.offsetMinutes.toLong() * 60_000L }
      val channelOffsetMs = HashMap<String, Long>()
      for (binding in effectiveBindings) configuredOffsets[binding.channelId]?.let { channelOffsetMs.putIfAbsent(binding.xmltvId, it) }
      // The first import may begin before an XMLTV directory exists. Learn
      // unique playlist-name matches while streaming the <channel> directory so
      // their <programme> rows are retained in this same transaction.
      val activePlaylistNames = EpgDatabase.shared(reactContext).uniquePlaylistNames(effectiveBindings.map { it.channelId })
      val now = System.currentTimeMillis(); val minStop = now - retentionDays().toLong() * DAY_MS; val maxStart = now + GUIDE_WINDOW_MS
      val channelNames = LinkedHashMap<String, String>(); val channelIcons = LinkedHashMap<String, String>(); var acceptedProgrammeCount = 0L; var programmeSwapSucceeded = false
      val batches = streamFilteredXmltv(sourceUrl, activeXmltvIds, activePlaylistNames, minStop, maxStart, baseOffsetMs, channelOffsetMs, channelNames, channelIcons, targetDatabase) { acceptedProgrammeCount += 1L }
      if (activeXmltvIds.isEmpty()) { for (ignored in batches) Unit } else {
        try { targetDatabase.replaceBatches(batches); programmeSwapSucceeded = true }
        catch (t: IllegalStateException) {
          val emptyFeed = acceptedProgrammeCount == 0L && t.message.orEmpty().contains("Refusing to replace live EPG with an empty feed"); if (!emptyFeed) throw t
        }
      }
      val aliases = ArrayList<Triple<String, String, String>>(channelNames.size * 2)
      for ((channelId, displayName) in channelNames) { aliases.add(Triple(channelId, "display_name", displayName)); aliases.add(Triple(channelId, "xmltv_id", channelId)) }
      for ((channelId, logoUrl) in channelIcons) if (logoUrl.isNotBlank()) aliases.add(Triple(channelId, "icon_url", logoUrl))
      targetDatabase.replaceChannelAliases(aliases)
      val previousGuideEpoch = targetDatabase.getMeta("guide_epoch")?.toLongOrNull() ?: 0L; val previousGuideRefreshedAt = targetDatabase.getMeta("guide_refreshed_at")?.toLongOrNull() ?: 0L
      val guideEpoch = if (programmeSwapSucceeded) previousGuideEpoch + 1L else previousGuideEpoch; val guideRefreshedAt = if (programmeSwapSucceeded) now else previousGuideRefreshedAt
      if (programmeSwapSucceeded) { targetDatabase.setMeta("guide_epoch", guideEpoch.toString()); targetDatabase.setMeta("guide_refreshed_at", guideRefreshedAt.toString()) }
      targetDatabase.setMeta("custom_programme_scope", activeXmltvIds.size.toString())
      val finishedMs = System.currentTimeMillis(); val count = targetDatabase.count()
      controlDao.putImportState(EpgImportStateEntity(playlistId = sourceId, lastAttemptSeconds = startedMs / 1000L, lastSuccessSeconds = if (programmeSwapSucceeded) finishedMs / 1000L else previousState?.lastSuccessSeconds ?: 0L, state = if (programmeSwapSucceeded) "succeeded" else "last_good_kept", attemptCount = 0, lastDurationMs = finishedMs - startedMs, lastProgrammeCount = count, lastTrigger = "manual"))
      if (historyId > 0L) controlDao.finishUpdateHistory(historyId, if (programmeSwapSucceeded) "succeeded" else "last_good_kept", finishedMs / 1000L, count, "")
      controlDao.trimUpdateHistory(100)
      promise.resolve(Arguments.createMap().apply { putDouble("count", count.toDouble()); putDouble("directoryCount", channelNames.size.toDouble()); putDouble("bindingCount", activeXmltvIds.size.toDouble()); putDouble("guideEpoch", guideEpoch.toDouble()); putDouble("guideRefreshedAt", guideRefreshedAt.toDouble()); putBoolean("programmeSwapSucceeded", programmeSwapSucceeded) })
    } catch (t: Throwable) {
      runCatching {
        val previous = controlDao.importState(sourceId)
        val safeMessage = EpgDiagnosticSafety.message(t)
        controlDao.putImportState(EpgImportStateEntity(playlistId = sourceId, lastAttemptSeconds = startedMs / 1000L, lastSuccessSeconds = previous?.lastSuccessSeconds ?: 0L, lastError = safeMessage, state = "failed", attemptCount = attempt, lastDurationMs = System.currentTimeMillis() - startedMs, lastProgrammeCount = previous?.lastProgrammeCount ?: 0L, lastTrigger = "manual"))
        if (historyId > 0L) controlDao.finishUpdateHistory(historyId, "failed", System.currentTimeMillis() / 1000L, 0L, safeMessage)
        controlDao.trimUpdateHistory(100)
      }
      promise.reject("CUSTOM_EPG_REFRESH_FAILED", t.message ?: "Custom Guide refresh failed", t)
    }
  }

  private fun streamFilteredXmltv(sourceUrl: String, activeXmltvIds: MutableSet<String>, activePlaylistNames: Set<String>, minStop: Long, maxStart: Long, baseOffsetMs: Long, channelOffsetMs: Map<String, Long>, channelNames: MutableMap<String, String>, channelIcons: MutableMap<String, String>, targetDatabase: EpgDatabase, onAcceptedProgramme: () -> Unit): Sequence<List<NativeEpgProgram>> = sequence {
    openPossiblyGzipped(sourceUrl, targetDatabase).use { input ->
      val parser = Xml.newPullParser(); parser.setInput(input, "UTF-8"); val batch = ArrayList<NativeEpgProgram>(BATCH_SIZE)
      var event = parser.eventType; var metadataChannelId: String? = null; var channelId: String? = null; var startMs = 0L; var endMs = 0L; var keepProgram = false; var title = ""; var description: String? = null; var category: String? = null; var rawProgrammeCount = 0L
      while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
          XmlPullParser.START_TAG -> when (parser.name) {
            "channel" -> metadataChannelId = parser.getAttributeValue(null, "id")?.trim()?.takeIf { it.isNotEmpty() }
            "display-name" -> { val id = metadataChannelId; if (!id.isNullOrBlank()) { val displayName = parser.nextText().trim(); if (displayName.isNotEmpty() && !channelNames.containsKey(id)) channelNames[id] = displayName; if (EpgDatabase.normalizeKey(displayName) in activePlaylistNames) activeXmltvIds.add(id) } }
            "icon" -> { val id = metadataChannelId; val src = parser.getAttributeValue(null, "src")?.trim().orEmpty(); if (!id.isNullOrBlank() && src.isNotEmpty() && !channelIcons.containsKey(id)) channelIcons[id] = src }
            "programme" -> {
              rawProgrammeCount += 1L; if (rawProgrammeCount > MAX_PROGRAMME_COUNT) throw IllegalStateException("Custom EPG exceeds programme safety limit")
              // Import runs on its own executor with bounded batches. A change
              // of focused screen must not abort this source's transaction.
              if ((rawProgrammeCount and 0x1ffL) == 0L) Thread.yield()
              channelId = parser.getAttributeValue(null, "channel")?.trim(); val offset = baseOffsetMs + (channelId?.let(channelOffsetMs::get) ?: 0L); val rawStart = parseXmltvTime(parser.getAttributeValue(null, "start")); val parsedStop = parseXmltvTime(parser.getAttributeValue(null, "stop")); startMs = rawStart + offset; endMs = resolveProgrammeStop(rawStart, parsedStop) + offset
              keepProgram = !channelId.isNullOrBlank() && channelId in activeXmltvIds && startMs > 0L && endMs > startMs && endMs >= minStop && startMs <= maxStart; title = ""; description = null; category = null
            }
            "title" -> if (keepProgram) title = parser.nextText().trim()
            "desc" -> if (keepProgram) description = parser.nextText().trim().ifEmpty { null }
            "category" -> if (keepProgram && category.isNullOrBlank()) category = parser.nextText().trim().ifEmpty { null }
          }
          XmlPullParser.END_TAG -> when (parser.name) {
            "channel" -> metadataChannelId = null
            "programme" -> { val id = channelId; if (keepProgram && !id.isNullOrBlank()) { onAcceptedProgramme(); batch.add(NativeEpgProgram(id, title.ifBlank { "No Information" }, description, category, startMs, endMs)); if (batch.size >= BATCH_SIZE) { yield(ArrayList(batch)); batch.clear() } }; channelId = null; keepProgram = false }
          }
        }; event = parser.next()
      }; if (batch.isNotEmpty()) yield(ArrayList(batch))
    }
  }

  private fun openPossiblyGzipped(urlString: String, targetDatabase: EpgDatabase): InputStream {
    var currentUrl = URL(urlString); var redirects = 0
    while (true) {
      val scheme = currentUrl.protocol.lowercase(Locale.US); if (scheme != "http" && scheme != "https") throw IllegalStateException("Custom EPG redirect used unsupported scheme: $scheme")
      val connection = currentUrl.openConnection() as HttpURLConnection; connection.connectTimeout = 15_000; connection.readTimeout = 45_000; connection.instanceFollowRedirects = false; connection.setRequestProperty("User-Agent", "TiviMate/5.1.6 (Linux; Android TV)"); connection.setRequestProperty("Accept", "*/*"); connection.setRequestProperty("Accept-Encoding", "gzip")
      val status = try { connection.connect(); connection.responseCode } catch (t: Throwable) { connection.disconnect(); throw t }
      if (isRedirect(status)) { val location = connection.getHeaderField("Location")?.trim().orEmpty(); connection.disconnect(); if (location.isEmpty()) throw IllegalStateException("Custom EPG HTTP $status redirect missing Location"); redirects += 1; if (redirects > MAX_HTTP_REDIRECTS) throw IllegalStateException("Custom EPG redirect limit exceeded"); currentUrl = URL(currentUrl, location); continue }
      if (status !in 200..299) { connection.disconnect(); throw IllegalStateException("Custom EPG HTTP $status") }
      val declaredLength = connection.contentLengthLong; if (declaredLength > MAX_COMPRESSED_EPG_BYTES) { connection.disconnect(); throw IllegalStateException("Custom EPG exceeds compressed safety limit") }
      try {
        targetDatabase.assertRefreshStorageAvailable(declaredLength)
        val connectionStream = object : FilterInputStream(connection.inputStream) { override fun close() { try { super.close() } finally { connection.disconnect() } } }
        val compressed = BoundedInputStream(connectionStream, MAX_COMPRESSED_EPG_BYTES); val buffered = BufferedInputStream(compressed, NETWORK_BUFFER_SIZE); buffered.mark(2); val b1 = buffered.read(); val b2 = buffered.read(); buffered.reset(); val decoded = if (b1 == 0x1f && b2 == 0x8b) GZIPInputStream(buffered, NETWORK_BUFFER_SIZE) else buffered
        return BoundedInputStream(decoded, MAX_DECOMPRESSED_EPG_BYTES)
      } catch (t: Throwable) { connection.disconnect(); throw t }
    }
  }

  private fun isRedirect(status: Int): Boolean = status == HttpURLConnection.HTTP_MOVED_PERM || status == HttpURLConnection.HTTP_MOVED_TEMP || status == HttpURLConnection.HTTP_SEE_OTHER || status == 307 || status == 308
  private fun resolveProgrammeStop(startMs: Long, parsedStopMs: Long): Long { if (startMs <= 0L) return 0L; return if (parsedStopMs > startMs && parsedStopMs - startMs <= MAX_PROGRAMME_DURATION_MS) parsedStopMs else startMs + DEFAULT_PROGRAMME_DURATION_MS }
  private fun parseXmltvTime(raw: String?): Long {
    if (raw == null) return 0L; val value = raw.trim(); if (value.length < 14) return 0L
    return try {
      fun digits(offset: Int, count: Int): Int { var result = 0; for (i in offset until offset + count) { val digit = value[i].code - '0'.code; if (digit !in 0..9) throw NumberFormatException("Invalid XMLTV time"); result = result * 10 + digit }; return result }
      val year = digits(0,4); val month = digits(4,2); val day = digits(6,2); val hour = digits(8,2); val minute = digits(10,2); val second = digits(12,2); if (month !in 1..12 || day !in 1..31 || hour !in 0..23 || minute !in 0..59 || second !in 0..59) return 0L
      var y = year.toLong(); val m = month.toLong(); val d = day.toLong(); y -= if (m <= 2L) 1L else 0L; val era = Math.floorDiv(y,400L); val yoe = y-era*400L; val mp = m + if (m>2L) -3L else 9L; val doy=(153L*mp+2L)/5L+d-1L; val doe=yoe*365L+yoe/4L-yoe/100L+doy; val epochDay=era*146097L+doe-719468L; var millis=epochDay*86_400_000L+hour*3_600_000L+minute*60_000L+second*1_000L
      var i=14; while(i<value.length&&value[i].isWhitespace()) i++; if(i+4<value.length&&(value[i]=='+'||value[i]=='-')) { val sign=if(value[i]=='-')-1 else 1; val oh=digits(i+1,2); val om=digits(i+3,2); if(oh<=23&&om<=59) millis-=sign*(oh*60L+om)*60_000L }; millis
    } catch (_: Throwable) { 0L }
  }

  override fun invalidate() { executor.shutdownNow(); queryExecutor.shutdownNow(); CustomEpgStoreRegistry.closeAll(); super.invalidate() }
  private class BoundedInputStream(input: InputStream, private val maxBytes: Long) : FilterInputStream(input) { private var bytesRead=0L; private fun account(count:Int):Int { if(count<=0)return count; bytesRead+=count.toLong(); if(bytesRead>maxBytes)throw IllegalStateException("Custom EPG exceeds size safety limit"); return count }; override fun read():Int { val value=super.read(); if(value>=0)account(1); return value }; override fun read(buffer:ByteArray,offset:Int,length:Int):Int=account(super.read(buffer,offset,length)) }
  companion object { private const val USER_SOURCE_ID="user"; private const val POLICY_PREFS="charm_epg_custom_policy"; private const val POLICY_PAST_DAYS="past_days"; private const val BATCH_SIZE=1000; private const val NETWORK_BUFFER_SIZE=64*1024; private const val MAX_HTTP_REDIRECTS=6; private const val MAX_COMPRESSED_EPG_BYTES=256L*1024L*1024L; private const val MAX_DECOMPRESSED_EPG_BYTES=1024L*1024L*1024L; private const val MAX_PROGRAMME_COUNT=2_000_000L; private const val DAY_MS=24L*60L*60L*1000L; private const val GUIDE_WINDOW_MS=72L*60L*60L*1000L; private const val DEFAULT_PROGRAMME_DURATION_MS=30L*60L*1000L; private const val MAX_PROGRAMME_DURATION_MS=24L*60L*60L*1000L }
}
