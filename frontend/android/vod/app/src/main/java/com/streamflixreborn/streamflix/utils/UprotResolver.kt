package com.streamflixreborn.streamflix.utils

import android.util.Base64
import com.streamflixreborn.streamflix.vod.VodHttp
import kotlinx.coroutines.CancellationException
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request

/** Uses the owner's existing resolver configuration; no downloaded executable config. */
object UprotResolver {
    private val client = VodHttp.client.newBuilder().followRedirects(true).followSslRedirects(true).build()

    suspend fun resolve(url: String): String? {
        val parsed = url.toHttpUrlOrNull() ?: return null
        if (parsed.username.isNotEmpty() || parsed.password.isNotEmpty()) return null
        if (parsed.host == "maxstream.video" || parsed.host.endsWith(".maxstream.video")) return url
        if (parsed.encodedPath.contains("/msd/")) return null
        if (parsed.host != "uprot.net" && !parsed.host.endsWith(".uprot.net")) return null
        try {
            val html = client.newCall(Request.Builder().url(url.replace("/msf/", "/mse/"))
                .header("User-Agent", NetworkClient.USER_AGENT).build()).awaitProviderResponse().use { VodHttp.text(it) }
            val base = Regex("""decodedBaseUrl\s*=\s*atob\(["']([^"']+)["']\)""").find(html)?.groupValues?.get(1)
            val value = Regex("""decodedEncryptedVal\s*=\s*atob\(["']([^"']+)["']\)""").find(html)?.groupValues?.get(1)
            if (base != null && value != null) {
                val target = String(Base64.decode(base, Base64.DEFAULT), Charsets.UTF_8) +
                    String(Base64.decode(value, Base64.DEFAULT), Charsets.UTF_8)
                target.toHttpUrlOrNull()?.takeIf { it.username.isEmpty() && it.password.isEmpty() }?.let { return it.toString() }
            }
        } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
        val id = Regex("""/ms[a-zA-Z]+/([A-Za-z0-9+/=]+)""").find(parsed.encodedPath)?.groupValues?.get(1) ?: return null
        val apiBase = if (parsed.encodedPath.contains("/msfi/") || parsed.encodedPath.contains("/msf/")) Keys.getUprotMsfiApiBase() else Keys.getUprotMseApiBase()
        val key = Keys.getUprotApiKey()
        if (apiBase.isBlank() || key.isBlank()) return null
        val endpoint = (apiBase + java.net.URLEncoder.encode(id, "UTF-8") + "&key=" + java.net.URLEncoder.encode(key, "UTF-8")).toHttpUrlOrNull() ?: return null
        return client.newCall(Request.Builder().url(endpoint).header("User-Agent", NetworkClient.USER_AGENT).build())
            .awaitProviderResponse().use { response ->
                if (!response.isSuccessful) return@use null
                val videoId = VodHttp.text(response, 16_384).trim()
                if (!videoId.matches(Regex("[A-Za-z0-9_-]{1,256}"))) return@use null
                "https://maxstream.video/emiuhi/$videoId"
            }
    }
}
