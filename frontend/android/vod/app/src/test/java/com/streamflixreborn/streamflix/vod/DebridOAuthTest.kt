package com.streamflixreborn.streamflix.vod

import kotlinx.coroutines.runBlocking
import okhttp3.FormBody
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class DebridOAuthTest {
    private val codeJson = """{"device_code":"private-device","user_code":"PUBLIC123","verification_url":"https://real-debrid.com/device","interval":7,"expires_in":600}"""
    @Test fun beginUsesPublicClientAndSeparatesDisplayedCode() = runBlocking {
        lateinit var sent: Request
        val code = DebridOAuth { sent=it; 200 to codeJson }.begin()
        assertEquals("https://api.real-debrid.com/oauth/v2/device/code",sent.url.toString().substringBefore('?'))
        assertEquals("yes",sent.url.queryParameter("new_credentials"))
        assertFalse(sent.url.queryParameter("client_id").isNullOrBlank())
        assertNull(sent.header("Authorization"))
        assertEquals("PUBLIC123",code.user)
        assertEquals("private-device",code.device)
        assertEquals(7L,code.intervalSeconds)
        assertFalse(code.verification.contains(code.device))
    }
    @Test fun pendingApprovalDoesNotProduceCredentials() = runBlocking {
        var sent: Request? = null
        val code = DebridOAuth { 200 to codeJson }.begin()
        assertNull(DebridOAuth { sent=it; 403 to """{"error":"authorization_pending"}""" }.credentials(code))
        assertEquals("private-device",sent!!.url.queryParameter("code"))
    }
    @Test fun authorizedCredentialsRequireBothParts() = runBlocking {
        val code = DebridOAuth { 200 to codeJson }.begin()
        assertNull(DebridOAuth { 200 to """{"client_id":"user-client"}""" }.credentials(code))
        assertEquals("secret", DebridOAuth { 200 to """{"client_id":"user-client","client_secret":"secret"}""" }
            .credentials(code)!!.getString("client_secret"))
    }
    @Test fun exchangeAndRefreshKeepSecretsInPostBody() = runBlocking {
        for (grantCode in listOf("private-device", "refresh-value")) {
            lateinit var sent: Request
            val result = DebridOAuth { sent=it; 200 to """{"access_token":"access","refresh_token":"rotated","expires_in":3600}""" }
                .token("user-client","secret",grantCode)
            assertEquals("POST",sent.method)
            assertNull(sent.url.query)
            val form=sent.body as FormBody
            val fields=(0 until form.size).associate { form.name(it) to form.value(it) }
            assertEquals(grantCode,fields["code"])
            assertEquals("http://oauth.net/grant_type/device/1.0",fields["grant_type"])
            assertEquals("secret",fields["client_secret"])
            assertEquals("oauth",result.getString("auth_mode"))
            assertEquals("rotated",result.getString("refresh_token"))
            assertTrue(result.getLong("expires_at") > System.currentTimeMillis())
        }
    }
    @Test fun rejectsIncompleteTokenAndDoesNotEchoResponse() = runBlocking {
        try {
            DebridOAuth { 200 to """{"access_token":"private-access"}""" }.token("id","secret","code")
            fail("Incomplete credentials were accepted")
        } catch (e: IOException) { assertFalse(e.message.orEmpty().contains("private-access")) }
        try {
            DebridOAuth { 401 to "private-response" }.token("id","secret","code")
            fail("Unauthorized token accepted")
        } catch (e: IOException) { assertFalse(e.message.orEmpty().contains("private-response")) }
    }
    @Test fun onlyOfficialDevicePagesCanOpen() {
        assertNotNull(DebridOAuth.verificationUrl("https://real-debrid.com/device/ABC123"))
        for (url in listOf("http://real-debrid.com/device", "https://real-debrid.com.evil.test/device",
            "https://evil.test/device", "https://user@real-debrid.com/device", "https://real-debrid.com:444/device",
            "https://real-debrid.com/apitoken", "javascript:alert(1)")) assertNull(url,DebridOAuth.verificationUrl(url))
    }
    @Test fun invalidBrowserLinkFallsBackWithoutExposingPrivateCode() = runBlocking {
        val result = DebridOAuth { 200 to codeJson.replace("https://real-debrid.com/device","https://evil.test/device") }.begin()
        assertEquals("https://real-debrid.com/device",result.verification)
        assertNull(result.direct)
    }
    @Test fun debridHostMatchingRequiresDomainBoundaryAndNoCredentials() {
        val domains = setOf("streamtape.com")
        assertTrue(DebridHosts.eligible("https://streamtape.com/v/abc",domains))
        assertTrue(DebridHosts.eligible("https://www.streamtape.com/v/abc",domains))
        for(url in listOf("https://streamtape.com.evil.test/v/abc","https://evilstreamtape.com/v/abc",
            "https://user@streamtape.com/v/abc","https://streamtape.com/","magnet:?xt=abc"))
            assertFalse(url,DebridHosts.eligible(url,domains))
    }
}
