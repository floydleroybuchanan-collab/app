package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.BuildConfig
import kotlinx.coroutines.delay
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

/** RD's documented public-client protocol. User-bound secrets never ship in the APK. */
internal class DebridOAuth(
    private val transport: suspend (Request) -> Pair<Int, String> = { request ->
        VodHttp.request(request).use { it.code to VodHttp.text(it) }
    },
) {
    data class Code(val device: String, val user: String, val verification: String,
        val direct: String?, val intervalSeconds: Long, val expiresSeconds: Long)
    private val base = "https://api.real-debrid.com/oauth/v2/"
    private val clientId get() = BuildConfig.REAL_DEBRID_CLIENT_ID
    suspend fun begin(): Code {
        val url = (base + "device/code").toHttpUrl().newBuilder()
            .addQueryParameter("client_id", clientId).addQueryParameter("new_credentials", "yes").build()
        val data = call(Request.Builder().url(url).build())
        return Code(data.getString("device_code"), data.getString("user_code"),
            verificationUrl(data.optString("verification_url")) ?: "https://real-debrid.com/device",
            verificationUrl(data.optString("direct_verification_url")),
            data.optLong("interval", 5).coerceAtLeast(5).also { require(it <= 1800) },
            data.optLong("expires_in", 600).coerceIn(1, 1800))
    }
    suspend fun credentials(code: Code): JSONObject? {
        val url = (base + "device/credentials").toHttpUrl().newBuilder()
            .addQueryParameter("client_id", clientId).addQueryParameter("code", code.device).build()
        val (status, body) = transport(Request.Builder().url(url).build())
        // RD uses 403 while waiting for approval. Bound this state by the device-code expiry.
        if (status == 403) return null
        if (status == 429 || status >= 500) { delay(code.intervalSeconds * 1000); return null }
        if (status !in 200..299) throw IOException("Authorization could not continue. Generate a new code.")
        return JSONObject(body).takeIf { it.optString("client_id").isNotBlank() && it.optString("client_secret").isNotBlank() }
    }
    suspend fun token(client: String, secret: String, code: String): JSONObject {
        val form = FormBody.Builder().add("client_id", client).add("client_secret", secret)
            .add("code", code).add("grant_type", "http://oauth.net/grant_type/device/1.0").build()
        val data = call(Request.Builder().url(base + "token").post(form).build())
        if (data.optString("access_token").isBlank() || data.optString("refresh_token").isBlank())
            throw IOException("Real-Debrid returned incomplete credentials. Please reconnect.")
        return data.put("client_id", client).put("client_secret", secret).put("auth_mode", "oauth")
            .put("expires_at", System.currentTimeMillis() + data.optLong("expires_in", 3600).coerceIn(1, 604800) * 1000)
    }
    private suspend fun call(request: Request): JSONObject {
        val (status, body) = transport(request)
        if (status !in 200..299) throw IOException(
            if (status == 429) "Real-Debrid is busy. Please wait before retrying."
            else "Real-Debrid authorization failed. Please reconnect.")
        return JSONObject(body)
    }
    companion object {
        fun verificationUrl(value: String): String? = runCatching {
            value.toHttpUrl().takeIf { it.isHttps && it.host == "real-debrid.com" &&
                it.username.isEmpty() && it.password.isEmpty() && it.port == 443 &&
                (it.encodedPath == "/device" || it.encodedPath.startsWith("/device/")) }?.toString()
        }.getOrNull()
    }
}
