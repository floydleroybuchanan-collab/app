package com.streamflixreborn.streamflix.vod

import org.junit.Assert.*
import org.junit.Test
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

class DebridInputTest {
    @Test fun invalidPasteNeverEchoesToken() {
        for (bad in listOf("secret\nextra", "secret extra", "secret\u0100", "", "secret".repeat(800))) {
            val error = runCatching { DebridInput.token(bad) }.exceptionOrNull()
            assertNotNull(error)
            assertFalse(error!!.message.orEmpty().contains("secret"))
        }
        assertEquals("abc-DEF_123", DebridInput.token(" abc-DEF_123 "))
    }
    @Test fun serviceBodyIsBoundedBeforeJsonParsing() {
        fun response(body: String) = Response.Builder().request(Request.Builder().url("https://example.test").build())
            .protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body.toResponseBody()).build()
        response("small").use { assertEquals("small", VodHttp.text(it, 5)) }
        response("oversized").use { assertNotNull(runCatching { VodHttp.text(it, 5) }.exceptionOrNull()) }
        val unknownLength = object : okhttp3.ResponseBody() {
            override fun contentType(): okhttp3.MediaType? = null
            override fun contentLength() = -1L
            override fun source(): okio.BufferedSource = okio.Buffer().writeUtf8("oversized")
        }
        response("").newBuilder().body(unknownLength).build().use {
            assertNotNull(runCatching { VodHttp.text(it, 5) }.exceptionOrNull())
        }
    }
}
