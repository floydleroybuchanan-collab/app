package com.charmiptv.app

import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.FilterInputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import okhttp3.Request
import okhttp3.Response

internal data class NativePlaylistChannel(
  val id: String,
  val rawTvgId: String,
  val name: String,
  val logo: String,
  val group: String,
  val url: String,
  val streamType: String,
)

internal data class NativePlaylistResult(
  val channels: List<NativePlaylistChannel>,
  val rejected: Int,
  val truncated: Boolean,
)

/**
 * Streaming M3U downloader/parser for TV devices. The playlist is never materialized
 * as one JS/Java String. We retain only the first MAX_CHANNELS lightweight raw rows
 * while scanning the complete input so duplicate tvg-id counts remain deterministic.
 *
 * Transport intentionally uses React Native's shared OkHttp stack. This mirrors the
 * provider-stream architecture documented by the TiViMate clean-room analysis and
 * keeps compatibility with IPTV servers that behave poorly with HttpURLConnection.
 * A whole-call deadline prevents a trickling/broken response from pinning startup at
 * the channel-import boundary indefinitely; callers preserve the last-good catalog.
 */
internal object NativePlaylistParser {
  private data class RawEntry(
    val tvgId: String,
    val name: String,
    val group: String,
    val logo: String,
    val url: String,
  )

  private data class Pending(
    val tvgId: String,
    val name: String,
    val group: String,
    val logo: String,
    val headers: LinkedHashMap<String, String> = LinkedHashMap(),
  )

  fun fetch(urlString: String): NativePlaylistResult {
    val rawEntries = ArrayList<RawEntry>(4096)
    val tvgCounts = HashMap<String, Int>()
    var rejected = 0
    var truncated = false
    var pending: Pending? = null

    openPlaylist(urlString).use { stream ->
      BufferedReader(InputStreamReader(stream, Charsets.UTF_8), NETWORK_BUFFER_SIZE).use { reader ->
        var firstLine = true
        var rawLineCount = 0L
        while (true) {
          val rawLine = reader.readLine() ?: break
          rawLineCount += 1L
          if ((rawLineCount and 0xffL) == 0L) {
            val owner = TvRemoteModule.remoteContext
            if (owner == "guide" || owner == "player" || owner == "modal") {
              throw IllegalStateException("Playlist refresh deferred for active TV interaction")
            }
          }
          var line = rawLine.trim()
          if (firstLine) {
            firstLine = false
            if (line.startsWith('\uFEFF')) line = line.substring(1).trim()
          }
          if (line.startsWith("#EXTINF")) {
            if (pending != null) rejected += 1
            val tvgId = attribute(line, "tvg-id").trim()
            val tvgName = attribute(line, "tvg-name").trim()
            val comma = line.lastIndexOf(',')
            val name = if (comma >= 0 && comma + 1 < line.length) {
              line.substring(comma + 1).trim().ifEmpty { tvgName.ifEmpty { "Channel" } }
            } else {
              tvgName.ifEmpty { "Channel" }
            }
            pending = Pending(
              tvgId = tvgId,
              name = name,
              group = attribute(line, "group-title").trim(),
              logo = attribute(line, "tvg-logo").trim(),
            )
            continue
          }

          val meta = pending ?: continue
          if (line.startsWith("#EXTVLCOPT:", ignoreCase = true) || line.startsWith("#EXTHTTP:", ignoreCase = true)) {
            applyExtHttpOption(meta.headers, line)
            continue
          }
          if (line.isEmpty() || line.startsWith('#')) continue
          pending = null
          val streamUrl = appendPipeHeaders(line, meta.headers)
          if (!isAllowedStreamUrl(streamUrl)) {
            rejected += 1
            continue
          }

          if (meta.tvgId.isNotEmpty()) {
            tvgCounts[meta.tvgId] = (tvgCounts[meta.tvgId] ?: 0) + 1
          }
          if (rawEntries.size < MAX_CHANNELS) {
            rawEntries.add(RawEntry(meta.tvgId, meta.name, meta.group, meta.logo, streamUrl))
          } else {
            truncated = true
          }
        }
      }
    }
    if (pending != null) rejected += 1

    val used = HashSet<String>(rawEntries.size * 2)
    val channels = ArrayList<NativePlaylistChannel>(rawEntries.size)
    for (entry in rawEntries) {
      val uniqueTvg = entry.tvgId.isNotEmpty() && (tvgCounts[entry.tvgId] ?: 0) == 1
      val fp = fingerprint(streamIdentityUrl(entry.url))
      val slug = slugify("${entry.name} ${entry.group}".trim()).ifEmpty {
        slugify(entry.name).ifEmpty { "ch-$fp" }
      }
      var preferred = when {
        uniqueTvg -> entry.tvgId
        entry.tvgId.isNotEmpty() -> "${entry.tvgId}~$fp"
        else -> slug
      }
      preferred = clipId(preferred.trim().ifEmpty { "ch-$fp" })

      val id = if (used.add(preferred)) {
        preferred
      } else {
        allocateFallbackId(entry, used)
      }
      channels.add(
        NativePlaylistChannel(
          id = id,
          rawTvgId = entry.tvgId,
          name = entry.name,
          logo = entry.logo,
          group = entry.group,
          url = entry.url,
          streamType = streamType(entry.url),
        )
      )
    }

    return NativePlaylistResult(channels, rejected, truncated)
  }

  private fun openPlaylist(urlString: String): InputStream {
    val cleanUrl = urlString.trim()
    if (!isHttpUrl(cleanUrl)) {
      throw IllegalStateException("M3U URL must use http or https")
    }

    // Preserve the provider protocol exactly. Many Xtream-style providers use
    // cleartext HTTP for both playlist and XMLTV endpoints; sideload builds
    // explicitly permit that transport. Stream URLs inside the M3U are also
    // retained verbatim.
    // Share CookieJar with Media3 so panel session cookies from M3U apply to streams.
    val client = CharmHttpClients.playlistClient(OkHttpClientProvider.getOkHttpClient()).newBuilder()
      .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .build()
    val request = Request.Builder()
      .url(cleanUrl)
      .header("User-Agent", "TiviMate/5.1.6 (Linux; Android TV)")
      .header("Accept", "application/x-mpegURL,application/vnd.apple.mpegurl,audio/mpegurl,application/xml,text/xml,*/*")
      .build()
    val response = client.newCall(request).execute()
    if (!response.isSuccessful) {
      val code = response.code
      response.close()
      throw IllegalStateException("M3U HTTP $code")
    }
    val body = response.body
    if (body == null) {
      response.close()
      throw IllegalStateException("M3U response had no body")
    }
    val declared = body.contentLength()
    if (declared > MAX_PLAYLIST_BYTES) {
      response.close()
      throw IllegalStateException("Playlist exceeds size limit ($MAX_PLAYLIST_BYTES bytes)")
    }

    try {
      val responseStream = ResponseClosingInputStream(body.byteStream(), response)
      val bounded = BoundedInputStream(responseStream, MAX_PLAYLIST_BYTES)
      val buffered = BufferedInputStream(bounded, NETWORK_BUFFER_SIZE)
      buffered.mark(2)
      val b1 = buffered.read()
      val b2 = buffered.read()
      buffered.reset()
      val decoded = if (b1 == 0x1f && b2 == 0x8b) {
        GZIPInputStream(buffered, NETWORK_BUFFER_SIZE)
      } else {
        buffered
      }
      return BoundedInputStream(decoded, MAX_PLAYLIST_BYTES)
    } catch (t: Throwable) {
      response.close()
      throw t
    }
  }

  private fun isHttpUrl(raw: String): Boolean {
    val schemeEnd = raw.indexOf(':')
    if (schemeEnd <= 0) return false
    return when (raw.substring(0, schemeEnd).lowercase(Locale.US)) {
      "http", "https" -> true
      else -> false
    }
  }

  /** Small direct attribute scanner; avoids regex allocation in the #EXTINF hot loop. */
  private fun attribute(line: String, key: String): String {
    var from = 0
    while (true) {
      val index = line.indexOf(key, from, ignoreCase = true)
      if (index < 0) return ""
      val beforeOk = index == 0 || line[index - 1].isWhitespace()
      var cursor = index + key.length
      while (cursor < line.length && line[cursor].isWhitespace()) cursor += 1
      if (beforeOk && cursor < line.length && line[cursor] == '=') {
        cursor += 1
        while (cursor < line.length && line[cursor].isWhitespace()) cursor += 1
        if (cursor >= line.length) return ""
        val quote = line[cursor]
        if (quote == '"' || quote == '\'') {
          val end = line.indexOf(quote, cursor + 1)
          return if (end > cursor) line.substring(cursor + 1, end) else ""
        }
        var end = cursor
        while (end < line.length && !line[end].isWhitespace()) end += 1
        return line.substring(cursor, end)
      }
      from = index + key.length
    }
  }

  private fun applyExtHttpOption(headers: LinkedHashMap<String, String>, line: String) {
    val payload = line.substringAfter(':', "").trim()
    if (payload.isEmpty()) return
    val lower = payload.lowercase(Locale.US)
    when {
      lower.startsWith("http-user-agent=") -> headers["User-Agent"] = payload.substringAfter('=').trim()
      lower.startsWith("http-referrer=") || lower.startsWith("http-referer=") ->
        headers["Referer"] = payload.substringAfter('=').trim()
      lower.startsWith("http-cookie=") -> headers["Cookie"] = payload.substringAfter('=').trim()
      lower.startsWith("http-header=") -> {
        val header = payload.substringAfter('=').trim()
        val colon = header.indexOf(':')
        if (colon > 0) {
          val key = header.substring(0, colon).trim()
          val value = header.substring(colon + 1).trim()
          if (key.isNotEmpty() && value.isNotEmpty()) headers[key] = value
        }
      }
      // Ignore non-HTTP VLC options (network-caching, http-reconnect, …). Emitting
      // them as request headers breaks panels/CDNs that TiViMate still plays.
    }
  }

  private fun appendPipeHeaders(url: String, headers: Map<String, String>): String {
    if (headers.isEmpty()) return url
    val encoded = headers.entries.joinToString("&") { (key, value) ->
      // Match encodeURIComponent on the JS parser: spaces are %20, literal
      // plus signs are %2B. Pipe metadata must never use form decoding.
      "${java.net.URLEncoder.encode(key, Charsets.UTF_8.name()).replace("+", "%20")}=${java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")}"
    }
    return if (url.contains('|')) "$url&$encoded" else "$url|$encoded"
  }

  private fun isAllowedStreamUrl(raw: String): Boolean {
    val identity = streamIdentityUrl(raw)
    val colon = identity.indexOf(':')
    if (colon <= 0) return false
    return when (identity.substring(0, colon).lowercase(Locale.US)) {
      "http", "https", "rtsp", "rtsps", "rtmp", "rtmps", "rtp", "udp", "srt", "rist" -> true
      else -> false
    }
  }

  private fun streamIdentityUrl(url: String): String =
    url.substringBefore('|').trim().lowercase(Locale.US)

  /**
   * Preserve a compact transport/container hint for the playback layer. Media3
   * still sniffs the actual progressive container and then selects codecs from
   * the tracks; this hint is only used to choose the correct MediaSource and
   * live-transport recovery policy for extensionless/provider-style URLs.
   */
  private fun streamType(url: String): String {
    val clean = streamIdentityUrl(url)
    val protocol = clean.substringBefore(':')
    if (protocol in setOf("rtsp", "rtsps", "rtmp", "rtmps", "rtp", "udp", "srt", "rist")) return protocol
    val path = clean.substringBefore('?')
    val query = clean.substringAfter('?', "")
    val paddedQuery = if (query.isEmpty()) "" else "&$query&"
    return when {
      path.endsWith(".m3u8") ||
        clean.contains("/hls/") ||
        paddedQuery.contains("&format=m3u8&") ||
        paddedQuery.contains("&type=hls&") ||
        paddedQuery.contains("&output=hls&") ||
        paddedQuery.contains("&format=hls&") ||
        paddedQuery.contains("&type=m3u8&") ||
        paddedQuery.contains("&output=m3u8&") -> "hls"
      path.endsWith(".mpd") ||
        clean.contains("/dash/") ||
        paddedQuery.contains("&format=mpd&") ||
        paddedQuery.contains("&type=dash&") ||
        paddedQuery.contains("&output=dash&") ||
        paddedQuery.contains("&format=dash&") ||
        paddedQuery.contains("&type=mpd&") ||
        paddedQuery.contains("&output=mpd&") -> "dash"
      path.endsWith(".ts") || path.endsWith(".m2ts") ||
        clean.contains("mpegts") || clean.contains("mpeg-ts") ||
        paddedQuery.contains("&format=ts&") ||
        paddedQuery.contains("&type=ts&") ||
        paddedQuery.contains("&output=ts&") ||
        paddedQuery.contains("&format=mpegts&") ||
        paddedQuery.contains("&type=mpegts&") ||
        paddedQuery.contains("&output=mpegts&") -> "ts"
      path.endsWith(".mp4") || path.endsWith(".m4v") || path.endsWith(".m4a") ||
        path.endsWith(".m4s") || path.endsWith(".mov") || path.endsWith(".webm") ||
        path.endsWith(".mkv") || path.endsWith(".avi") || path.endsWith(".flv") ||
        path.endsWith(".mpg") || path.endsWith(".mpeg") || path.endsWith(".vob") ||
        path.endsWith(".mp3") || path.endsWith(".aac") || path.endsWith(".ogg") ||
        path.endsWith(".wav") || path.endsWith(".flac") || path.endsWith(".amr") ||
        path.endsWith(".cmfv") || path.endsWith(".cmfa") -> "progressive"
      else -> "unknown"
    }
  }

  /** Catalog drawer hint only — never forces Media3 opaque routing. */
  fun catalogKind(url: String): String {
    val path = streamIdentityUrl(url).substringBefore('?')
    return when {
      Regex("/series/", RegexOption.IGNORE_CASE).containsMatchIn(path) -> "series"
      Regex("/movie/", RegexOption.IGNORE_CASE).containsMatchIn(path) ||
        Regex("/movies/", RegexOption.IGNORE_CASE).containsMatchIn(path) ||
        Regex("/vod/", RegexOption.IGNORE_CASE).containsMatchIn(path) -> "movie"
      Regex("/live/", RegexOption.IGNORE_CASE).containsMatchIn(path) ||
        Regex("/timeshift/", RegexOption.IGNORE_CASE).containsMatchIn(path) -> "live"
      else -> "unknown"
    }
  }

  private fun fingerprint(value: String): String {
    var hash = 5381
    for (ch in value) hash = ((hash shl 5) + hash) xor ch.code
    return hash.toUInt().toString(16).padStart(8, '0')
  }

  private fun slugify(value: String): String {
    val out = StringBuilder(value.length)
    var dashPending = false
    for (ch in value) {
      val asciiAlphaNum = ch in 'a'..'z' || ch in 'A'..'Z' || ch in '0'..'9'
      if (asciiAlphaNum) {
        if (dashPending && out.isNotEmpty()) out.append('-')
        out.append(ch.lowercaseChar())
        dashPending = false
      } else if (out.isNotEmpty()) {
        dashPending = true
      }
    }
    return out.toString().trim('-')
  }

  private fun clipId(value: String): String = if (value.length <= MAX_CHANNEL_ID_LEN) value else value.substring(0, MAX_CHANNEL_ID_LEN)

  private fun allocateFallbackId(entry: RawEntry, used: MutableSet<String>): String {
    val fp = fingerprint(streamIdentityUrl(entry.url))
    val slug = slugify("${entry.name} ${entry.group}".trim()).ifEmpty {
      slugify(entry.name).ifEmpty { "ch-$fp" }
    }
    val preferred = clipId(slug.ifEmpty { "ch-$fp" })
    if (used.add(preferred)) return preferred
    val withFp = clipId("$preferred~$fp")
    if (used.add(withFp)) return withFp
    var n = 2
    while (true) {
      val candidate = clipId("$withFp~$n")
      if (used.add(candidate)) return candidate
      n += 1
    }
  }

  private class ResponseClosingInputStream(
    input: InputStream,
    private val response: Response,
  ) : FilterInputStream(input) {
    override fun close() {
      try {
        super.close()
      } finally {
        response.close()
      }
    }
  }

  private class BoundedInputStream(input: InputStream, private val maxBytes: Long) : FilterInputStream(input) {
    private var bytesRead = 0L

    private fun account(count: Int): Int {
      if (count <= 0) return count
      bytesRead += count.toLong()
      if (bytesRead > maxBytes) throw IllegalStateException("Playlist exceeds size limit ($MAX_PLAYLIST_BYTES bytes)")
      return count
    }

    override fun read(): Int {
      val value = super.read()
      if (value >= 0) account(1)
      return value
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = account(super.read(buffer, offset, length))
  }

  private const val NETWORK_BUFFER_SIZE = 64 * 1024
  private const val CONNECT_TIMEOUT_SECONDS = 15L
  private const val READ_TIMEOUT_SECONDS = 45L
  private const val CALL_TIMEOUT_SECONDS = 90L
  private const val MAX_PLAYLIST_BYTES = 32L * 1024L * 1024L
  private const val MAX_CHANNELS = 25_000
  private const val MAX_CHANNEL_ID_LEN = 160
}
