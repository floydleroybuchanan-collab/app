package com.streamflixreborn.streamflix.utils

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class CharmTmdbAuthInterceptorTest {
    private fun client(custom: String, bundled: String, seen: MutableList<String>): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(CharmTmdbAuthInterceptor(custom, bundled))
            .addInterceptor(Interceptor { chain ->
                val key = chain.request().url.queryParameter("api_key") ?: ""
                seen += key
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(if (key == "valid") 200 else 401)
                    .message("TEST")
                    .body("{}".toResponseBody())
                    .build()
            }).build()

    private fun request() = Request.Builder().url("https://api.themoviedb.org/3/movie/popular?api_key=previous").build()

    @Test fun validCustomKeyDoesNotRetry() {
        val seen = mutableListOf<String>()
        client("valid", "bundled", seen).newCall(request()).execute().use { response ->
            assertEquals(200, response.code)
        }
        assertEquals(listOf("valid"), seen)
    }

    @Test fun staleCustomKeyFallsBackOnceAndFutureRequestsUseBundledKey() {
        val seen = mutableListOf<String>()
        val client = client("stale", "valid", seen)
        client.newCall(request()).execute().use { assertEquals(200, it.code) }
        client.newCall(request()).execute().use { assertEquals(200, it.code) }
        assertEquals(listOf("stale", "valid", "valid"), seen)
    }

    @Test fun noFallbackKeyNeverLoops() {
        val seen = mutableListOf<String>()
        client("stale", "", seen).newCall(request()).execute().use { assertEquals(401, it.code) }
        assertEquals(listOf("stale"), seen)
    }

    @Test fun noConfiguredKeyReportsClearFailureWithoutNetworkRequest() {
        val seen = mutableListOf<String>()
        try {
            client("", "", seen).newCall(request()).execute().close()
            fail("Expected missing key error")
        } catch (e: IOException) {
            assertTrue(e.message.orEmpty().contains("TMDb API key is missing"))
        }
        assertTrue(seen.isEmpty())
    }

    @Test fun twoInvalidKeysRetryOnlyOnce() {
        val seen = mutableListOf<String>()
        client("stale", "bundled", seen).newCall(request()).execute().use { assertEquals(401, it.code) }
        assertEquals(listOf("stale", "bundled"), seen)
    }

    @Test fun bundledKeyWorksWithoutCustomOverride() {
        val seen = mutableListOf<String>()
        client("", "valid", seen).newCall(request()).execute().use { assertEquals(200, it.code) }
        assertEquals(listOf("valid"), seen)
    }
}
