package com.charmiptv.app

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** Cookies survive tunes; bounds and expiry are applied on access, never by a flush timer. */
internal class BoundedCookieJar(
  private val maxCookies: Int = 512,
  private val maxPerDomain: Int = 64,
  private val maxBytes: Long = 256L * 1024L,
  private val maxCookieBytes: Long = 16L * 1024L,
  private val nowMs: () -> Long = System::currentTimeMillis,
) : CookieJar {
  private data class Key(val name: String, val domain: String, val path: String)
  private data class Entry(val cookie: Cookie, val bytes: Long, val created: Long, var used: Long)
  private val entries = LinkedHashMap<Key, Entry>()
  private var retainedBytes = 0L
  private var sequence = 0L

  init { require(maxCookies > 0 && maxPerDomain > 0 && maxBytes > 0 && maxCookieBytes > 0) }

  @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    val now = nowMs()
    removeExpired(now)
    for (cookie in cookies) {
      val sameHost = url.host == cookie.domain
      if (!sameHost && (cookie.hostOnly || !url.host.endsWith("." + cookie.domain))) continue
      val key = Key(cookie.name, cookie.domain, cookie.path)
      if (cookie.expiresAt <= now) {
        entries.remove(key)?.let { retainedBytes -= it.bytes }
        continue
      }
      val bytes = 128L + 2L * (cookie.name.length.toLong() + cookie.value.length + cookie.domain.length + cookie.path.length)
      if (bytes > maxCookieBytes || bytes > maxBytes) continue // Never truncate credentials.
      // A rejected oversized replacement must not delete the valid credential
      // already in the jar. Explicit expiry above still performs deletion.
      val old = entries.remove(key)
      if (old != null) retainedBytes -= old.bytes
      val ordinal = ++sequence
      entries[key] = Entry(cookie, bytes, old?.created ?: ordinal, ordinal)
      retainedBytes += bytes
      while (entries.values.count { it.cookie.domain == cookie.domain } > maxPerDomain) evictOldest(cookie.domain)
      while (entries.size > maxCookies || retainedBytes > maxBytes) evictOldest()
    }
  }

  @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> {
    removeExpired(nowMs())
    val matched = entries.values.filter { it.cookie.matches(url) }
      .sortedWith(compareByDescending<Entry> { it.cookie.path.length }.thenBy { it.created })
    for (entry in matched) entry.used = ++sequence
    return matched.map { it.cookie }
  }

  @Synchronized fun size(): Int = entries.size
  @Synchronized fun estimatedBytes(): Long = retainedBytes

  private fun removeExpired(now: Long) {
    val iterator = entries.entries.iterator()
    while (iterator.hasNext()) {
      val entry = iterator.next().value
      if (entry.cookie.expiresAt <= now) { retainedBytes -= entry.bytes; iterator.remove() }
    }
  }

  private fun evictOldest(domain: String? = null) {
    val oldest = entries.entries.asSequence()
      .filter { domain == null || it.value.cookie.domain == domain }
      .minByOrNull { it.value.used } ?: return
    retainedBytes -= oldest.value.bytes
    entries.remove(oldest.key)
  }
}
