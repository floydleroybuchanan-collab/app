package com.charmiptv.app

import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CharmHttpClientsTest {
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

  @Test fun exportedCookiesRespectSecureAndPathScope() {
    MockWebServer().use { server ->
      server.start()
      server.enqueue(MockResponse()
        .addHeader("Set-Cookie", "audit_private=secret; Path=/private")
        .addHeader("Set-Cookie", "audit_secure=secret; Path=/; Secure"))
      CharmHttpClients.mediaClient().newCall(Request.Builder().url(server.url("/private/login")).build()).execute().close()
      val publicCookies = CharmHttpClients.cookieHeaderFor(server.url("/public").toString()).orEmpty()
      assertFalse(publicCookies.contains("audit_private="))
      assertFalse(publicCookies.contains("audit_secure="))
      val privateCookies = CharmHttpClients.cookieHeaderFor(server.url("/private/live").toString()).orEmpty()
      assertTrue(privateCookies.contains("audit_private=secret"))
      assertFalse(privateCookies.contains("audit_secure="))
    }
  }
}
