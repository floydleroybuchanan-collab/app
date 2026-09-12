package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.models.Video
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import org.json.JSONArray

internal object DebridHosts {
    private val lock = Mutex()
    private var domains = emptySet<String>()
    private var fetchedAt = 0L
    suspend fun supported(): Set<String> = lock.withLock {
        if (domains.isEmpty() || System.currentTimeMillis() - fetchedAt > 1800000) {
            val fresh = VodHttp.request(Request.Builder().url("https://api.real-debrid.com/rest/1.0/hosts/domains").build()).use {
                if (!it.isSuccessful) throw java.io.IOException("Real-Debrid host list is unavailable.")
                JSONArray(VodHttp.text(it))
            }
            domains = (0 until fresh.length()).map { fresh.getString(it).lowercase() }.toSet()
            fetchedAt = System.currentTimeMillis()
        }
        domains
    }
    fun eligible(url: String, domains: Set<String>): Boolean {
        val parsed = url.toHttpUrlOrNull() ?: return false
        return parsed.username.isEmpty() && parsed.password.isEmpty() && parsed.encodedPath != "/" &&
            domains.any { parsed.host == it || parsed.host.endsWith("." + it) }
    }
    suspend fun sources(servers: List<Video.Server>): List<Video.Server> {
        val supported = supported()
        return servers.mapNotNull { source ->
            if (source.details?.isDebrid == true) return@mapNotNull null
            val link = source.src.ifBlank { source.id }
            if (!eligible(link, supported)) return@mapNotNull null
            source.copy(id = "rd-host:" + link, name = source.name + " · Real-Debrid",
                src = link, details = (source.details ?: SourceDetails()).copy(
                    kind = SourceDetails.Kind.REAL_DEBRID_HOST, originalHostUrl = link))
        }.distinctBy { it.src }
    }
}
