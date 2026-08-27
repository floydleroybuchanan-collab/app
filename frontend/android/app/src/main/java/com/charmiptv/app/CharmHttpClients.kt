package com.charmiptv.app

import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import java.net.CookieManager
import java.net.CookiePolicy
import java.util.concurrent.TimeUnit

/**
 * Shared HTTP identity for playlist fetch, Media3 stream bytes, and VLC header
 * injection.
 *
 * One CookieManager so Set-Cookie from M3U/panel redirects is available on the
 * later media GETs (TiViMate-class panels that gate segments on session cookies).
 */
object CharmHttpClients {
  // ACCEPT_ALL matches IPTV panel behavior better than ACCEPT_ORIGINAL_SERVER,
  // which drops many Domain=/cross-host cookies TiViMate-class clients keep.
  private val cookieManager = CookieManager(null, CookiePolicy.ACCEPT_ALL)
  private val cookieJar = JavaNetCookieJar(cookieManager)

  /** Playlist / XMLTV-class: bounded read. */
  fun playlistClient(base: OkHttpClient): OkHttpClient =
    base.newBuilder()
      .cookieJar(cookieJar)
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(45, TimeUnit.SECONDS)
      .followRedirects(true)
      .followSslRedirects(true)
      .build()

  /** Live media: timeout applies between reads, not to total stream duration. */
  fun mediaClient(): OkHttpClient =
    OkHttpClient.Builder()
      .cookieJar(cookieJar)
      .connectionPool(okhttp3.ConnectionPool(6, 5, TimeUnit.MINUTES))
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .writeTimeout(0, TimeUnit.SECONDS)
      .retryOnConnectionFailure(true)
      .followRedirects(true)
      .followSslRedirects(true)
      .build()

  /** Cookie header for LibVLC (no OkHttp stack) from the shared jar. */
  fun cookieHeaderFor(uri: String): String? {
    return try {
      val cookies = cookieManager.cookieStore.get(java.net.URI(uri))
      if (cookies.isNullOrEmpty()) null
      else cookies.joinToString("; ") { "${it.name}=${it.value}" }
    } catch (_: Throwable) {
      null
    }
  }
}
