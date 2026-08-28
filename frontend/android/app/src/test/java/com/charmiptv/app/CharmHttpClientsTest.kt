package com.charmiptv.app

import okhttp3.Request
import okhttp3.OkHttpClient
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CharmHttpClientsTest {
  @Test fun javaScriptPlaylistRedirectCookiesReachMedia3WithoutReplacingItsCookieContainer() {
    MockWebServer().use { server ->
      server.start()
      val base = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES).build()
      val jsClient = CharmHttpClients.bridgeReactNativeCookies(base)
      assertTrue(jsClient.cookieJar === base.cookieJar)
      assertEquals(base.readTimeoutMillis, jsClient.readTimeoutMillis)
      assertEquals(base.callTimeoutMillis, jsClient.callTimeoutMillis)
      server.enqueue(MockResponse().setResponseCode(302)
        .addHeader("Location", server.url("/catalog"))
        .addHeader("Set-Cookie", "audit_js_redirect=a+b; Path=/"))
      server.enqueue(MockResponse().setBody("#EXTM3U"))
      jsClient.newCall(Request.Builder().url(server.url("/panel")).build()).execute().close()
      server.takeRequest()
      server.takeRequest()
      server.enqueue(MockResponse().setBody("media"))
      CharmHttpClients.mediaClient().newCall(Request.Builder().url(server.url("/live")).build()).execute().close()
      assertTrue(server.takeRequest().getHeader("Cookie").orEmpty().contains("audit_js_redirect=a+b"))
    }
  }

  @Test fun mirroredJavaScriptCookiesRetainSecurePathAndDomainScope() {
    MockWebServer().use { server ->
      server.start()
      val jsClient = CharmHttpClients.bridgeReactNativeCookies(OkHttpClient())
      server.enqueue(MockResponse()
        .addHeader("Set-Cookie", "audit_js_private=secret; Path=/private")
        .addHeader("Set-Cookie", "audit_js_secure=secret; Path=/; Secure")
        .addHeader("Set-Cookie", "audit_js_foreign=secret; Domain=unrelated.invalid; Path=/"))
      jsClient.newCall(Request.Builder().url(server.url("/private/login")).build()).execute().close()
      server.takeRequest()
      val media = CharmHttpClients.mediaClient()
      server.enqueue(MockResponse().setBody("media"))
      media.newCall(Request.Builder().url(server.url("/public")).build()).execute().close()
      val publicCookies = server.takeRequest().getHeader("Cookie").orEmpty()
      for (name in listOf("audit_js_private=", "audit_js_secure=", "audit_js_foreign=")) assertFalse(publicCookies.contains(name))
      server.enqueue(MockResponse().setBody("media"))
      media.newCall(Request.Builder().url(server.url("/private/live")).build()).execute().close()
      val privateCookies = server.takeRequest().getHeader("Cookie").orEmpty()
      assertTrue(privateCookies.contains("audit_js_private=secret"))
      assertFalse(privateCookies.contains("audit_js_secure="))
      assertFalse(privateCookies.contains("audit_js_foreign="))
    }
  }

  @Test fun explicitProviderCookieIsNotReplacedByThePanelCookieJar() {
    MockWebServer().use { server ->
      server.start()
      val client = CharmHttpClients.mediaClient()
      server.enqueue(MockResponse().addHeader("Set-Cookie", "audit_panel=jar-value; Path=/"))
      client.newCall(Request.Builder().url(server.url("/playlist")).build()).execute().close()
      server.takeRequest()

      server.enqueue(MockResponse().setBody("media"))
      val headers = mapOf("Cookie" to "provider=a+b%2Bc")
      CharmHttpClients.mediaClientForHeaders(client, headers)
        .newCall(Request.Builder().url(server.url("/live" )).header("Cookie", headers.getValue("Cookie")).build())
        .execute().close()
      assertEquals("provider=a+b%2Bc", server.takeRequest().getHeader("Cookie"))
    }
  }

  @Test fun mediaRequestsRespectCookieSecureAndPathScope() {
    MockWebServer().use { server ->
      server.start()
      val client = CharmHttpClients.mediaClient()
      server.enqueue(MockResponse()
        .addHeader("Set-Cookie", "audit_private=secret; Path=/private")
        .addHeader("Set-Cookie", "audit_secure=secret; Path=/; Secure"))
      client.newCall(Request.Builder().url(server.url("/private/login")).build()).execute().close()
      server.takeRequest()
      server.enqueue(MockResponse().setBody("media"))
      client.newCall(Request.Builder().url(server.url("/public")).build()).execute().close()
      val publicCookies = server.takeRequest().getHeader("Cookie").orEmpty()
      assertFalse(publicCookies.contains("audit_private="))
      assertFalse(publicCookies.contains("audit_secure="))
      server.enqueue(MockResponse().setBody("media"))
      client.newCall(Request.Builder().url(server.url("/private/live")).build()).execute().close()
      val privateCookies = server.takeRequest().getHeader("Cookie").orEmpty()
      assertTrue(privateCookies.contains("audit_private=secret"))
      assertFalse(privateCookies.contains("audit_secure="))
    }
  }

  @Test fun healthyStreamsHaveNoTotalCallDeadline() {
    val client = CharmHttpClients.mediaClient()
    assertEquals(0, client.callTimeoutMillis)
    assertEquals(20_000, client.connectTimeoutMillis)
    assertEquals(20_000, client.readTimeoutMillis)
    assertTrue(client.retryOnConnectionFailure)
  }
}
