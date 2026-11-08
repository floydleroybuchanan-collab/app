package com.streamflixreborn.streamflix.utils

import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response

/**
 * TMDb-specific API-key recovery. A saved custom key has priority; after an
 * HTTP 401 it falls back once per request to the key supplied during the APK
 * build. No credentials are written to logs or persisted by the fallback.
 *
 * Other HTTP errors (including 403/429), and 401s from other providers or
 * Real-Debrid, are intentionally untouched.
 */
internal class CharmTmdbAuthInterceptor(
    customKey: String,
    bundledKey: String,
) : Interceptor {
    private val custom = customKey.trim()
    private val bundled = bundledKey.trim()
    private val canFallback = custom.isNotEmpty() && bundled.isNotEmpty() && custom != bundled
    private val useBundled = AtomicBoolean(custom.isEmpty())

    override fun intercept(chain: Interceptor.Chain): Response {
        val selected = if (useBundled.get()) bundled else custom
        if (selected.isEmpty()) {
            throw IOException("TMDb API key is missing. Set a key in VOD Settings or configure TMDB_API_KEY for the APK build.")
        }
        val first = chain.proceed(withKey(chain.request(), selected))
        if (first.code != 401 || !canFallback || selected != custom) return first

        // Close the first response before calling proceed again, as OkHttp
        // requires; concurrent requests may independently hit this branch.
        useBundled.set(true)
        first.close()
        return chain.proceed(withKey(chain.request(), bundled))
    }

    private fun withKey(request: Request, key: String): Request = request.newBuilder()
        .url(request.url.newBuilder().setQueryParameter("api_key", key).build())
        .build()
}
