package com.charmiptv.app

import android.net.Uri
import java.util.Locale

/**
 * TiViMate-class live URL helpers shared by Media3 and VLC.
 *
 * Extensionless Xtream `/live/user/pass/id` URLs often only deliver bytes when
 * a `.ts` / `.m3u8` / `.mp4` suffix is appended. Both engines rotate those
 * variants on start-timeout the same way TiViMate-class clients probe formats.
 */
object CharmStreamUrls {
  fun isHttpOrHttps(uri: String): Boolean {
    val scheme = try {
      Uri.parse(uri).scheme?.lowercase(Locale.US)
    } catch (_: Throwable) {
      null
    }
    return scheme == "http" || scheme == "https"
  }

  fun isOpaqueHttpUri(uri: String): Boolean {
    if (!isHttpOrHttps(uri)) return false
    val lower = uri.lowercase(Locale.US)
    if (
      lower.contains("format=") ||
      lower.contains("type=") ||
      lower.contains("output=") ||
      lower.contains("/hls/") ||
      lower.contains("/dash/")
    ) {
      return false
    }
    return !Regex("\\.[a-z0-9]{2,5}(?:$|[?#])").containsMatchIn(lower)
  }

  fun opaqueUriVariants(uri: String): List<String> {
    if (!isOpaqueHttpUri(uri)) return listOf(uri)
    return try {
      val parsed = Uri.parse(uri)
      val path = parsed.path ?: return listOf(uri)
      if (path.isEmpty()) return listOf(uri)
      val out = LinkedHashSet<String>()
      out.add(uri)
      for (suffix in listOf(".ts", ".m3u8", ".mp4")) {
        out.add(parsed.buildUpon().path(path + suffix).build().toString())
      }
      out.toList()
    } catch (_: Throwable) {
      listOf(uri)
    }
  }
}
