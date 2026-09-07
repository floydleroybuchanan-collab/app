package com.charmiptv.app

import android.content.Context
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.zip.GZIPInputStream

internal data class BackgroundEpgResult(
  val programmeCount: Long,
  val directoryCount: Int,
  val swapped: Boolean,
)

/**
 * Process-independent XMLTV updater used by WorkManager.
 *
 * The React bridge remains the interactive importer. This service gives every
 * configured EPG source a native path that can download, decompress, filter and
 * atomically replace its last-good programme table while the UI process is not
 * running. It deliberately reuses the same Room control rows and EpgDatabase
 * stores consumed by CombinedGuideRepository.
 */
internal class BackgroundEpgUpdater(private val context: Context) {
  private val dao = EpgControlDatabase.get(context).dao()

  fun refresh(source: EpgSourceEntity): BackgroundEpgResult {
    val threadId = android.os.Process.myTid()
    val previousPriority = android.os.Process.getThreadPriority(threadId)
    try {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
      return acquireImport(source).use { refreshLocked(source) }
    } finally { android.os.Process.setThreadPriority(previousPriority) }
  }

  fun acquireImport(source: EpgSourceEntity): AutoCloseable =
    (if (source.playlistId == PRIMARY_SOURCE) EpgDatabase.shared(context)
      else CustomEpgStoreRegistry.database(context, source.playlistId)).acquireImport()

  private fun refreshLocked(source: EpgSourceEntity): BackgroundEpgResult {
    val sourceId = source.playlistId
    val primary = sourceId == PRIMARY_SOURCE
    val database = if (primary) EpgDatabase.shared(context) else CustomEpgStoreRegistry.database(context, sourceId)
    require(source.enabled && source.url.isNotBlank()) { "Guide source is disabled or has no address" }
    check(database.ensureHealthy()) { "Guide database integrity check failed" }
    database.assertRefreshStorageAvailable()

    val activeChannels = EpgDatabase.shared(context).activePlaylistChannels()
    val activeChannelIds = activeChannels.mapTo(HashSet()) { it.playlistId }
    val bindings = if (primary) {
      activeChannels
        .filter { it.matchedXmltvId.isNotBlank() }
        .map { EpgChannelBindingEntity(sourceId, it.playlistId, it.matchedXmltvId) }
    } else dao.effectiveBindings(sourceId).filter { it.channelId in activeChannelIds }
    val activeIds = bindings.mapTo(LinkedHashSet()) { it.xmltvId }
    // Disabled playlists keep their saved assignments, but automatic work
    // must not download a feed used only by those disabled channels. Explicit
    // Refresh in EPG settings still indexes an unassigned feed for setup.
    if (activeIds.isEmpty()) return BackgroundEpgResult(database.count(), 0, false)
    val offsetsByPlaylist = dao.channelOffsets(sourceId).associate { it.channelId to it.offsetMinutes }
    val offsetsByXmltv = HashMap<String, Long>()
    for (binding in bindings) {
      val minutes = offsetsByPlaylist[binding.channelId] ?: continue
      offsetsByXmltv.putIfAbsent(binding.xmltvId, minutes.toLong() * MINUTE_MS)
    }
    val baseOffsetMs = (source.serverOffsetMinutes + source.playlistOffsetMinutes + GuideTimingPolicy.globalOffsetMinutes(context)).toLong() * MINUTE_MS
    val now = System.currentTimeMillis()
    val minStop = now - DEFAULT_PAST_DAYS * DAY_MS
    val maxStart = now + GUIDE_WINDOW_MS
    val names = LinkedHashMap<String, String>()
    val icons = LinkedHashMap<String, String>()
    var accepted = 0L
    val batches = stream(
      source.url,
      database,
      activeIds,
      minStop,
      maxStart,
      baseOffsetMs,
      offsetsByXmltv,
      names,
      icons,
    ) { accepted += 1L }

    var swapped = false
    if (activeIds.isNotEmpty()) {
      database.replaceBatches(batches) {
        val current = dao.source(sourceId)
        check(current != null && current.enabled && current.url == source.url && current.updatedAtSeconds == source.updatedAtSeconds) {
          "Guide source changed while its update was running"
        }
      }
      swapped = true
    } else {
      // Still consume the stream so the directory can be indexed for a later
      // manual/automatic assignment without replacing good programme rows.
      for (ignored in batches) Unit
    }
    val aliases = ArrayList<Triple<String, String, String>>(names.size * 2 + icons.size)
    for ((id, name) in names) {
      aliases.add(Triple(id, "display_name", name))
      aliases.add(Triple(id, "xmltv_id", id))
    }
    for ((id, icon) in icons) if (icon.isNotBlank()) aliases.add(Triple(id, "icon_url", icon))
    database.replaceChannelAliases(aliases)
    if (swapped) {
      val epoch = (database.getMeta("guide_epoch")?.toLongOrNull() ?: 0L) + 1L
      database.setMeta("guide_epoch", epoch.toString())
      database.setMeta("guide_refreshed_at", now.toString())
      database.deleteExpired(minStop)
    }
    return BackgroundEpgResult(database.count(), names.size, swapped)
  }

  private fun stream(
    sourceUrl: String,
    database: EpgDatabase,
    activeIds: Set<String>,
    minStop: Long,
    maxStart: Long,
    baseOffsetMs: Long,
    offsetsByXmltv: Map<String, Long>,
    names: MutableMap<String, String>,
    icons: MutableMap<String, String>,
    onAccepted: () -> Unit,
  ): Sequence<List<NativeEpgProgram>> = sequence {
    open(sourceUrl, database).use { input ->
      val parser = Xml.newPullParser()
      parser.setInput(input, "UTF-8")
      val batch = ArrayList<NativeEpgProgram>(BATCH_SIZE)
      var event = parser.eventType
      var metadataId: String? = null
      var channelId: String? = null
      var startMs = 0L
      var endMs = 0L
      var keep = false
      var title = ""
      var description: String? = null
      var category: String? = null
      var rawProgrammes = 0L
      while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
          XmlPullParser.START_TAG -> when (parser.name) {
            "channel" -> metadataId = parser.getAttributeValue(null, "id")?.trim()?.takeIf(String::isNotEmpty)
            "display-name" -> metadataId?.let { id -> parser.nextText().trim().takeIf(String::isNotEmpty)?.let { names.putIfAbsent(id, it) } }
            "icon" -> metadataId?.let { id -> parser.getAttributeValue(null, "src")?.trim()?.takeIf(String::isNotEmpty)?.let { icons.putIfAbsent(id, it) } }
            "programme" -> {
              rawProgrammes += 1L
              check(rawProgrammes <= MAX_PROGRAMMES) { "Guide exceeds programme safety limit" }
              channelId = parser.getAttributeValue(null, "channel")?.trim()
              val id = channelId.orEmpty()
              val offset = baseOffsetMs + (offsetsByXmltv[id] ?: 0L)
              val rawStart = parseTime(parser.getAttributeValue(null, "start"))
              val rawStop = parseTime(parser.getAttributeValue(null, "stop"))
              startMs = rawStart + offset
              endMs = (if (rawStop > 0L) rawStop else rawStart + DEFAULT_DURATION_MS) + offset
              keep = id.isNotBlank() && id in activeIds && startMs > 0L && endMs > startMs && endMs >= minStop && startMs <= maxStart
              title = ""; description = null; category = null
            }
            "title" -> if (keep) title = parser.nextText().trim()
            "desc" -> if (keep) description = parser.nextText().trim().ifEmpty { null }
            "category" -> if (keep && category.isNullOrBlank()) category = parser.nextText().trim().ifEmpty { null }
          }
          XmlPullParser.END_TAG -> when (parser.name) {
            "channel" -> metadataId = null
            "programme" -> {
              val id = channelId
              if (keep && !id.isNullOrBlank()) {
                onAccepted()
                batch.add(NativeEpgProgram(id, title.ifBlank { "No Information" }, description, category, startMs, endMs))
                if (batch.size >= BATCH_SIZE) { yield(ArrayList(batch)); batch.clear() }
              }
              channelId = null; keep = false
            }
          }
        }
        event = parser.next()
      }
      if (batch.isNotEmpty()) yield(ArrayList(batch))
    }
  }

  private fun open(rawUrl: String, database: EpgDatabase): InputStream {
    var current = URL(rawUrl)
    var redirects = 0
    while (true) {
      val scheme = current.protocol.lowercase(Locale.US)
      check(scheme == "http" || scheme == "https") { "Guide used unsupported URL scheme" }
      val connection = current.openConnection() as HttpURLConnection
      try {
        connection.connectTimeout = 15_000
        connection.readTimeout = 60_000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("User-Agent", "CharmIPTV/2 AndroidTV")
        connection.setRequestProperty("Accept-Encoding", "gzip")
        connection.connect()
        val code = connection.responseCode
        if (code in 300..399) {
          val location = connection.getHeaderField("Location") ?: error("Guide redirect had no destination")
          check(++redirects <= 8) { "Too many Guide redirects" }
          current = URL(current, location)
          continue
        }
        check(code in 200..299) { "Guide HTTP $code" }
        val declared = connection.contentLengthLong
        if (declared > 0L) database.assertRefreshStorageAvailable(declared)
        val counting = object : FilterInputStream(connection.inputStream) {
          private var readBytes = 0L
          private fun account(count: Int): Int {
            if (count > 0) {
              readBytes += count
              check(readBytes <= MAX_COMPRESSED_BYTES) { "Guide download exceeds safety limit" }
            }
            return count
          }
          override fun read(): Int = super.read().also { if (it >= 0) account(1) }
          override fun read(buffer: ByteArray, offset: Int, length: Int): Int = account(super.read(buffer, offset, length))
          override fun close() { try { super.close() } finally { connection.disconnect() } }
        }
        val buffered = BufferedInputStream(counting, 64 * 1024)
        buffered.mark(2)
        val first = buffered.read(); val second = buffered.read(); buffered.reset()
        val gzipped = connection.contentEncoding.equals("gzip", true) || current.path.endsWith(".gz", true) || (first == 0x1f && second == 0x8b)
        return if (gzipped) GZIPInputStream(buffered, 64 * 1024) else buffered
      } catch (t: Throwable) {
        connection.disconnect()
        throw t
      }
    }
  }

  private fun parseTime(raw: String?): Long {
    val value = raw?.trim().orEmpty()
    if (value.length < 14) return 0L
    return try {
      val base = value.substring(0, 14)
      val calendar = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
      calendar.clear()
      calendar.set(base.substring(0, 4).toInt(), base.substring(4, 6).toInt() - 1, base.substring(6, 8).toInt(), base.substring(8, 10).toInt(), base.substring(10, 12).toInt(), base.substring(12, 14).toInt())
      var result = calendar.timeInMillis
      val suffix = value.substring(14).trim()
      val match = Regex("([+-])(\\d{2})(\\d{2})").find(suffix)
      if (match != null) {
        val minutes = match.groupValues[2].toInt() * 60 + match.groupValues[3].toInt()
        result -= (if (match.groupValues[1] == "+") 1 else -1) * minutes * MINUTE_MS
      }
      result
    } catch (_: Throwable) { 0L }
  }

  companion object {
    private const val PRIMARY_SOURCE = "default"
    private const val BATCH_SIZE = 1000
    private const val MAX_PROGRAMMES = 2_000_000L
    private const val MAX_COMPRESSED_BYTES = 256L * 1024L * 1024L
    private const val MINUTE_MS = 60_000L
    private const val DAY_MS = 24L * 60L * MINUTE_MS
    private const val DEFAULT_PAST_DAYS = 7L
    private const val GUIDE_WINDOW_MS = 14L * DAY_MS
    private const val DEFAULT_DURATION_MS = 30L * MINUTE_MS
  }
}
