package com.charmiptv.app

import android.content.Context

/**
 * The User-Agent the viewer chose in Settings. Blank means "use the app default".
 *
 * Playlist, guide and stream requests that do not carry their own User-Agent use
 * [current]. A stream that sets its own User-Agent (an M3U `|User-Agent=` or
 * `#EXTVLCOPT:http-user-agent`) keeps it.
 */
object CharmUserAgent {
  const val DEFAULT = "TiviMate/5.1.6 (Linux; Android TV)"
  private const val PREFS = "charm_network"
  private const val KEY = "user_agent"
  private const val MAX_LENGTH = 200

  @Volatile private var cached: String? = null

  // A personal playlist can carry its own User-Agent. It is remembered per server (host and port) for as long
  // as the app runs, and set again by the app before each download, so nothing is stored here.
  private val perHost = java.util.concurrent.ConcurrentHashMap<String, String>()

  private fun hostKey(url: String): String? = runCatching {
    val uri = java.net.URI(url.trim())
    val host = uri.host?.lowercase() ?: return null
    "$host:${if (uri.port >= 0) uri.port else if (uri.scheme.equals("https", true)) 443 else 80}"
  }.getOrNull()

  /** Blank removes the playlist's own choice for that server. */
  fun setForUrl(url: String, raw: String?) {
    val key = hostKey(url) ?: return
    val value = clean(raw)
    if (value.isEmpty()) perHost.remove(key) else perHost[key] = value
  }

  /** The playlist's own User-Agent for this address, or null to use [current]. */
  fun forUrl(url: String): String? = hostKey(url)?.let { perHost[it] }

  /** Header-safe: one line, printable ASCII only, at most [MAX_LENGTH] characters. */
  fun clean(raw: String?): String = (raw ?: "").filter { it == '\t' || it in ' '..'~' }.trim().take(MAX_LENGTH)

  /** What the viewer saved, blank when they use the default. */
  fun stored(context: Context): String =
    clean(context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, ""))

  /** The viewer's choice when they made one, otherwise null. */
  fun overrideOrNull(context: Context): String? = stored(context).ifEmpty { null }

  /** The User-Agent to send. Pass a context the first time so the saved choice is read. */
  fun current(context: Context? = null): String {
    cached?.let { return it }
    if (context == null) return DEFAULT
    val value = stored(context).ifEmpty { DEFAULT }
    cached = value
    return value
  }

  fun set(context: Context, raw: String?) {
    val value = clean(raw)
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, value).apply()
    cached = value.ifEmpty { DEFAULT }
  }
}
