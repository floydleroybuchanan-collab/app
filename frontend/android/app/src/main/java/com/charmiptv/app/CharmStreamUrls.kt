package com.charmiptv.app

import android.net.Uri
import java.util.Locale

/** URL classification shared by the native playback path. */
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
}
