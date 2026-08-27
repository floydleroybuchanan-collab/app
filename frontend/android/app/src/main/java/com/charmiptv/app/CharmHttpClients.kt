package com.charmiptv.app

import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import java.net.CookieManager
import java.net.CookiePolicy
import java.util.concurrent.TimeUnit

/**
 * Shared HTTP identity for playlist fetch and Media3 stream bytes.
 *
 * One CookieManager so Set-Cookie from M3U/panel redirects is available on the
 * later media GETs (TiViMate-class panels that gate segments on session cookies).
 */
object CharmHttpClients {
  private val cookieManager = CookieManager(null, CookiePolicy.ACCEPT_ORIGINAL_SERVER)
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

  /** Live media: unbounded read (long-lived IPTV byte stream). */
  fun mediaClient(): OkHttpClient =
    OkHttpClient.Builder()
      .cookieJar(cookieJar)
      .connectionPool(okhttp3.ConnectionPool(6, 5, TimeUnit.MINUTES))
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.SECONDS)
      .writeTimeout(0, TimeUnit.SECONDS)
      .retryOnConnectionFailure(true)
      .followRedirects(true)
      .followSslRedirects(true)
      .build()
}
