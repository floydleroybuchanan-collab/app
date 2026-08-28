package com.charmiptv.app

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BoundedCookieJarTest {
  private val root = "https://provider.test/".toHttpUrl()
  private fun cookie(name: String, value: String = "a+b", path: String = "/"): Cookie.Builder =
    Cookie.Builder().name(name).value(value).hostOnlyDomain(root.host).path(path)

  @Test fun repeatedSegmentCookiesStayBoundedAndKeepActiveIdentity() {
    val jar = BoundedCookieJar(maxCookies = 8, maxPerDomain = 4)
    jar.saveFromResponse(root, listOf(cookie("auth", path = "/live").build()))
    repeat(1_000) {
      jar.loadForRequest("https://provider.test/live".toHttpUrl())
      jar.saveFromResponse(root, listOf(cookie("segment_$it", path = "/other").build()))
    }
    assertEquals(4, jar.size())
    assertEquals("a+b", jar.loadForRequest("https://provider.test/live".toHttpUrl()).single().value)
    repeat(1_000) { jar.saveFromResponse(root, listOf(cookie("session", "token_$it").build())) }
    assertEquals(4, jar.size())
    assertEquals("token_999", jar.loadForRequest(root).single { it.name == "session" }.value)
  }

  @Test fun pathsSecureFlagsAndHostOnlyCookiesAreRespected() {
    val jar = BoundedCookieJar()
    jar.saveFromResponse(root, listOf(cookie("session", "root").build(),
      cookie("session", "private", "/private").build(), cookie("secure").secure().build()))
    assertEquals(listOf("private", "root"), jar.loadForRequest("https://provider.test/private/live".toHttpUrl()).filter { it.name == "session" }.map { it.value })
    assertFalse(jar.loadForRequest("http://provider.test/".toHttpUrl()).any { it.name == "secure" })
    assertTrue(jar.loadForRequest("https://sub.provider.test/".toHttpUrl()).isEmpty())
    assertTrue(jar.loadForRequest("https://other.test/".toHttpUrl()).isEmpty())
  }

  @Test fun sharedDomainCookiesWorkWithoutAcceptingForeignDomains() {
    val jar = BoundedCookieJar()
    jar.saveFromResponse(root, listOf(
      cookie("shared").domain("provider.test").build(),
      cookie("foreign").domain("unrelated.test").build(),
    ))
    assertEquals(listOf("shared"), jar.loadForRequest("https://sub.provider.test/live".toHttpUrl()).map { it.name })
    assertEquals(1, jar.size())
  }

  @Test fun expiryAndDeletionAreOnDemandNotPeriodicSessionResets() {
    var now = 1_000L
    val jar = BoundedCookieJar(nowMs = { now })
    jar.saveFromResponse(root, listOf(cookie("short").expiresAt(2_000L).build(), cookie("session").build()))
    repeat(100) { assertEquals(2, jar.loadForRequest(root).size) }
    now = 2_001L
    assertEquals(listOf("session"), jar.loadForRequest(root).map { it.name })
    jar.saveFromResponse(root, listOf(cookie("session").expiresAt(1L).build()))
    assertEquals(0, jar.size())
  }

  @Test fun globalBytesAndCountStayBoundedWithoutTruncatingCookieValues() {
    val jar = BoundedCookieJar(maxCookies = 3, maxPerDomain = 3, maxBytes = 1_000L, maxCookieBytes = 400L)
    repeat(30) {
      val url = "https://p$it.test/".toHttpUrl()
      jar.saveFromResponse(url, listOf(Cookie.Builder().name("session").value("a+b").hostOnlyDomain(url.host).build()))
    }
    assertTrue(jar.size() <= 3)
    assertTrue(jar.estimatedBytes() <= 1_000L)
    jar.saveFromResponse(root, listOf(cookie("oversized", "x".repeat(1_000)).build()))
    assertTrue(jar.estimatedBytes() <= 1_000L)
    assertFalse(jar.loadForRequest(root).any { it.name == "oversized" })
  }

  @Test fun oversizedReplacementDoesNotDiscardExistingProviderAuthentication() {
    val jar = BoundedCookieJar(maxCookieBytes = 400L)
    jar.saveFromResponse(root, listOf(cookie("session", "valid+a%2Fb").build()))
    val before = jar.estimatedBytes()
    jar.saveFromResponse(root, listOf(cookie("session", "x".repeat(1_000)).build()))
    assertEquals("valid+a%2Fb", jar.loadForRequest(root).single().value)
    assertEquals(before, jar.estimatedBytes())
    jar.saveFromResponse(root, listOf(cookie("session", "x".repeat(1_000)).expiresAt(1L).build()))
    assertEquals(0, jar.size())
    assertEquals(0L, jar.estimatedBytes())
  }
}
