package com.streamflixreborn.streamflix.vod

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Separate client: no provider interceptors, cookies, credential logging, or cross-host redirects. */
internal object VodHttp {
    fun text(response: Response, limit: Long = 2_000_000): String {
        val body = response.body ?: return ""
        if (body.contentLength() > limit) throw IOException("Source response is too large.")
        val source = body.source()
        source.request(limit + 1)
        if (source.buffer.size > limit) throw IOException("Source response is too large.")
        return source.readUtf8()
    }
    val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS).callTimeout(40, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()

    suspend fun request(request: Request): Response = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(IOException("The source service could not be reached."))
            }
            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response) { _, value, _ -> value.close() }
            }
        })
    }
}
