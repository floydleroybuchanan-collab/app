package com.charmiptv.app

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Shared HTTP identity for playlist fetch and Media3 stream bytes.
 *
 * One bounded CookieJar so Set-Cookie from M3U/panel redirects is available on the
 * later media GETs (TiViMate-class panels that gate segments on session cookies).
 */
object CharmHttpClients {
  // No periodic cookie clearing; preserve valid host/domain/path/Secure identity
  // while bounding accumulated panel/session cookies.
  private val cookieJar = BoundedCookieJar()

  /**
   * The active M3U downloader is JS fetch, using React Native's own CookieJar.
   * Mirror response cookies (including redirect responses) into the media jar
   * without replacing RN's CookieJarContainer or changing its request handling.
   */
  fun bridgeReactNativeCookies(base: OkHttpClient): OkHttpClient =
    base.newBuilder().addNetworkInterceptor { chain ->
      val response = chain.proceed(chain.request())
      val cookies = Cookie.parseAll(response.request.url, response.headers)
      if (cookies.isNotEmpty()) cookieJar.saveFromResponse(response.request.url, cookies)
      response
    }.build()

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
      .callTimeout(0, TimeUnit.SECONDS) // No deadline on a healthy long-running stream.
      .retryOnConnectionFailure(true)
      .followRedirects(true)
      .followSslRedirects(true)
      .build()

  /** OkHttp's BridgeInterceptor otherwise replaces an explicit Cookie header. */
  fun mediaClientForHeaders(base: OkHttpClient, headers: Map<String, String>): OkHttpClient {
    if (headers.keys.none { it.equals("Cookie", ignoreCase = true) }) return base
    return base.newBuilder().cookieJar(object : CookieJar {
      override fun loadForRequest(url: HttpUrl): List<Cookie> = emptyList()
      override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = cookieJar.saveFromResponse(url, cookies)
    }).build()
  }

}
