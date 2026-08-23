package com.charmiptv.app

import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Resolves extensionless HTTP(S) IPTV endpoints without penalizing normal URLs.
 * The probe is bounded, follows redirects, preserves provider headers, and reads
 * only a small prefix before closing the response. Results are cached per URL.
 */
object OpaqueStreamProbe {
  data class Result(
    val sourceType: String,
    val mimeType: String?,
    val finalUrl: String,
    val httpCode: Int,
    val signature: String,
  )

  private const val MAX_SNIFF_BYTES = 4096L
  private val cache = ConcurrentHashMap<String, Result>()
  private val client = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .callTimeout(7, TimeUnit.SECONDS)
    .followRedirects(true)
    .followSslRedirects(true)
    .retryOnConnectionFailure(true)
    .build()

  fun cached(url: String): Result? = cache[url]

  fun probe(url: String, headers: Map<String, String>, callback: (Result?) -> Unit) {
    cache[url]?.let { callback(it); return }
    val request = try {
      Request.Builder().url(url).get().apply {
        headers.forEach { (key, value) -> if (key.isNotBlank() && value.isNotBlank()) header(key, value) }
        header("Range", "bytes=0-${MAX_SNIFF_BYTES - 1}")
        header("Accept-Encoding", "identity")
      }.build()
    } catch (_: Throwable) {
      callback(null); return
    }
    client.newCall(request).enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) = callback(null)
      override fun onResponse(call: Call, response: Response) {
        response.use {
          if (!response.isSuccessful) { callback(null); return }
          val mime = response.header("Content-Type")?.substringBefore(';')?.trim()?.lowercase(Locale.US)
          val bytes = try { response.body?.source()?.readByteArray(MAX_SNIFF_BYTES) ?: ByteArray(0) } catch (_: Throwable) { ByteArray(0) }
          val detected = detect(mime, bytes) ?: run { callback(null); return }
          val result = Result(detected.first, mime, response.request.url.toString(), response.code, detected.second)
          cache[url] = result
          callback(result)
        }
      }
    })
  }

  private fun detect(mime: String?, bytes: ByteArray): Pair<String, String>? {
    when (mime) {
      "application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl" -> return "hls" to "content-type"
      "application/dash+xml" -> return "dash" to "content-type"
      "video/mp2t" -> return "transport" to "content-type"
      "video/mp4", "audio/mp4", "application/mp4" -> return "progressive" to "content-type"
    }
    if (bytes.isEmpty()) return null
    val ascii = bytes.copyOfRange(0, minOf(bytes.size, 1024)).toString(Charsets.UTF_8).trimStart('\uFEFF', ' ', '\t', '\r', '\n')
    if (ascii.startsWith("#EXTM3U", ignoreCase = true)) return "hls" to "extm3u"
    if (ascii.startsWith("<?xml", ignoreCase = true) && ascii.contains("<MPD", ignoreCase = true) || ascii.startsWith("<MPD", ignoreCase = true)) return "dash" to "mpd"
    if (looksLikeTransportStream(bytes)) return "transport" to "ts-sync"
    if (looksLikeIsoBmff(bytes)) return "progressive" to "iso-bmff"
    return null
  }

  private fun looksLikeTransportStream(bytes: ByteArray): Boolean {
    val packetSizes = intArrayOf(188, 192, 204)
    for (packetSize in packetSizes) {
      for (offset in 0 until minOf(packetSize, bytes.size)) {
        var matches = 0
        var position = offset
        while (position < bytes.size && matches < 4) {
          if ((bytes[position].toInt() and 0xff) != 0x47) break
          matches += 1
          position += packetSize
        }
        if (matches >= 3) return true
      }
    }
    return false
  }

  private fun looksLikeIsoBmff(bytes: ByteArray): Boolean {
    if (bytes.size < 12) return false
    for (offset in 0..minOf(32, bytes.size - 8)) {
      val box = String(bytes, offset + 4, 4, Charsets.US_ASCII)
      if (box == "ftyp" || box == "styp" || box == "moof") return true
    }
    return false
  }
}
