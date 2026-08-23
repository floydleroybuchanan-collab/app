package com.charmiptv.app

import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.io.InputStream
import java.util.Locale

/**
 * Bounded format probe used only for opaque HTTP(S) IPTV URLs that have no
 * extension/query/playlist hint. It intentionally does not run for normal HLS,
 * TS, DASH or progressive URLs, so ordinary channel zaps keep their fast path.
 */
internal object NativeOpaqueStreamProbe {
  data class Result(
    val sourceType: String?,
    val contentType: String?,
    val httpCode: Int?,
    val finalUri: String?,
    val reason: String,
  )

  private const val MAX_SNIFF_BYTES = 4 * 1024

  fun start(
    client: OkHttpClient,
    uri: String,
    headers: Map<String, String>,
    callback: (Result) -> Unit,
  ): Call? {
    val request = try {
      Request.Builder().url(uri).get().apply {
        headers.forEach { (name, value) ->
          if (name.isNotBlank() && value.isNotBlank()) header(name, value)
        }
        if (headers.keys.none { it.equals("Accept", ignoreCase = true) }) header("Accept", "*/*")
      }.build()
    } catch (error: Throwable) {
      callback(Result(null, null, null, null, "invalid-url:${error.javaClass.simpleName}"))
      return null
    }

    val call = client.newCall(request)
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) {
        callback(Result(null, null, null, null, "io:${error.javaClass.simpleName}"))
      }

      override fun onResponse(call: Call, response: Response) {
        response.use { safeResponse ->
          val mime = normalizeContentType(safeResponse.header("Content-Type"))
          val finalUri = safeResponse.request.url.toString()
          val metadataType = sourceTypeFromMimeOrUri(mime, finalUri)
          if (metadataType != null) {
            val reason = if (sourceTypeFromMimeOrUri(mime, null) != null) "content-type:$mime" else "redirect-uri"
            callback(Result(metadataType, mime, safeResponse.code, finalUri, reason))
            return
          }
          val bytes = try {
            readPrefix(safeResponse.body?.byteStream(), MAX_SNIFF_BYTES)
          } catch (error: Throwable) {
            callback(Result(null, mime, safeResponse.code, finalUri, "body-read:${error.javaClass.simpleName}"))
            return
          }
          val detected = detect(mime, finalUri, bytes)
          callback(Result(detected.first, mime, safeResponse.code, finalUri, detected.second))
        }
      }
    })
    return call
  }

  internal fun detect(contentType: String?, finalUri: String?, bytes: ByteArray): Pair<String?, String> {
    val mimeType = normalizeContentType(contentType)
    sourceTypeFromMimeOrUri(mimeType, finalUri)?.let { return it to if (sourceTypeFromMimeOrUri(mimeType, null) != null) "content-type:$mimeType" else "redirect-uri" }

    val text = try {
      bytes.toString(Charsets.UTF_8).trimStart('\uFEFF', ' ', '\r', '\n', '\t')
    } catch (_: Throwable) {
      ""
    }
    if (text.startsWith("#EXTM3U", ignoreCase = true)) return "hls" to "signature:#EXTM3U"
    if (text.contains("<MPD", ignoreCase = true)) return "dash" to "signature:<MPD"
    if (looksLikeTransportStream(bytes)) return "transport" to "signature:mpeg-ts"
    if (looksLikeProgressiveContainer(bytes)) return "progressive" to "signature:progressive-container"
    return null to "signature:unknown"
  }

  private fun sourceTypeFromMimeOrUri(contentType: String?, finalUri: String?): String? {
    when (contentType) {
      "application/vnd.apple.mpegurl",
      "application/x-mpegurl",
      "audio/mpegurl",
      "audio/x-mpegurl" -> return "hls"
      "application/dash+xml" -> return "dash"
      "video/mp2t" -> return "transport"
      "video/mp4", "audio/mp4", "application/mp4",
      "video/webm", "audio/webm", "video/x-matroska",
      "video/x-flv", "audio/aac", "audio/mpeg", "audio/ogg",
      "application/ogg", "audio/flac", "audio/wav", "audio/x-wav" -> return "progressive"
    }

    val lower = finalUri?.lowercase(Locale.US).orEmpty()
    return when {
      Regex("\\.m3u8(?:$|[?#])").containsMatchIn(lower) || Regex("[?&](?:format|type|output)=(?:hls|m3u8)(?:&|$)").containsMatchIn(lower) || lower.contains("/hls/") -> "hls"
      Regex("\\.mpd(?:$|[?#])").containsMatchIn(lower) || Regex("[?&](?:format|type|output)=(?:dash|mpd)(?:&|$)").containsMatchIn(lower) || lower.contains("/dash/") -> "dash"
      Regex("\\.(?:ts|m2ts)(?:$|[?#])").containsMatchIn(lower) || Regex("[?&](?:format|type|output)=(?:ts|mpegts|mpeg-ts)(?:&|$)").containsMatchIn(lower) -> "transport"
      Regex("\\.(?:mp4|m4v|m4a|m4s|mov|webm|mkv|avi|flv|mpg|mpeg|vob|mp3|aac|ogg|wav|flac|amr|cmfv|cmfa)(?:$|[?#])").containsMatchIn(lower) -> "progressive"
      else -> null
    }
  }

  private fun normalizeContentType(value: String?): String? =
    value?.substringBefore(';')?.trim()?.lowercase(Locale.US)?.takeIf { it.isNotEmpty() }

  private fun readPrefix(input: InputStream?, maxBytes: Int): ByteArray {
    if (input == null) return ByteArray(0)
    val buffer = ByteArray(maxBytes)
    var total = 0
    while (total < buffer.size) {
      val read = input.read(buffer, total, buffer.size - total)
      if (read <= 0) break
      total += read
      if (total >= 16 && hasEarlyTextSignature(buffer, total)) break
      if (total >= 3 * 204 && (looksLikeTransportStream(buffer.copyOf(total)) || looksLikeProgressiveContainer(buffer.copyOf(total)))) break
    }
    return buffer.copyOf(total)
  }

  private fun hasEarlyTextSignature(buffer: ByteArray, length: Int): Boolean {
    val text = try { String(buffer, 0, length, Charsets.UTF_8) } catch (_: Throwable) { return false }
    return text.contains("#EXTM3U", ignoreCase = true) || text.contains("<MPD", ignoreCase = true)
  }

  private fun looksLikeTransportStream(bytes: ByteArray): Boolean {
    if (bytes.size < 3 * 188) return false
    for (spacing in intArrayOf(188, 192, 204)) {
      val maxOffset = minOf(spacing, bytes.size)
      for (offset in 0 until maxOffset) {
        val second = offset + spacing
        val third = second + spacing
        if (third >= bytes.size) break
        if (u8(bytes[offset]) == 0x47 && u8(bytes[second]) == 0x47 && u8(bytes[third]) == 0x47) return true
      }
    }
    return false
  }

  private fun looksLikeProgressiveContainer(bytes: ByteArray): Boolean {
    if (bytes.size >= 8) {
      val box = String(bytes, 4, 4, Charsets.US_ASCII)
      if (box == "ftyp" || box == "styp" || box == "moof" || box == "sidx") return true
    }
    if (bytes.size >= 4 && u8(bytes[0]) == 0x1a && u8(bytes[1]) == 0x45 && u8(bytes[2]) == 0xdf && u8(bytes[3]) == 0xa3) return true // Matroska/WebM EBML
    if (bytes.size >= 4 && String(bytes, 0, 4, Charsets.US_ASCII) == "OggS") return true
    if (bytes.size >= 3 && String(bytes, 0, 3, Charsets.US_ASCII) == "FLV") return true
    if (bytes.size >= 3 && String(bytes, 0, 3, Charsets.US_ASCII) == "ID3") return true
    if (bytes.size >= 4 && u8(bytes[0]) == 0x00 && u8(bytes[1]) == 0x00 && u8(bytes[2]) == 0x01 && u8(bytes[3]) == 0xba) return true // MPEG-PS
    if (bytes.size >= 2 && u8(bytes[0]) == 0xff && (u8(bytes[1]) and 0xf6) == 0xf0) return true // ADTS AAC
    return false
  }

  private fun u8(value: Byte): Int = value.toInt() and 0xff
}
