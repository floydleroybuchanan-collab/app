package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.models.Video
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.io.IOException

object SourceDiscovery {
    data class Result(val sources: List<Video.Server>, val message: String)
    internal fun cached(details: SourceDetails?) = details?.availability in setOf(SourceDetails.Availability.READY, SourceDetails.Availability.REPORTED_CACHED)
    /** Accept only Torrentio's RD resolve layout; never retain credential-bearing URLs in source objects. */
    internal fun parse(body: String, reported: Boolean): List<Video.Server> {
        val streams = try { JSONObject(body).optJSONArray("streams") } catch (_: org.json.JSONException) { null }
            ?: throw IOException("The search service returned an invalid source list. Use Retry.")
        return (0 until minOf(streams.length(), 500)).mapNotNull { i ->
            val row = streams.optJSONObject(i) ?: return@mapNotNull null
            if (reported && Regex("(?i)(invalid.*(key|token)|expired.*(key|token)|access.denied)").containsMatchIn(row.optString("name") + " " + row.optString("title")))
                throw IOException("Torrentio could not use this RD connection. Refresh or reconnect Real-Debrid in VOD Settings.")
            val url = row.optString("url").toHttpUrlOrNull()
            val segments = if (reported && url?.scheme == "https" && url.host == "torrentio.strem.fun") url.pathSegments else emptyList()
            val rdAt = segments.indexOf("realdebrid")
            val fromUrl = if (rdAt >= 0) segments.getOrNull(rdAt + 2) else null
            val hash = row.optString("infoHash").ifBlank { fromUrl.orEmpty() }.lowercase()
                .takeIf { it.matches(Regex("[a-f0-9]{40}")) } ?: return@mapNotNull null
            val index = if (row.has("fileIdx") && !row.isNull("fileIdx")) row.optInt("fileIdx", -1).takeIf { it >= 0 }
                else if (rdAt >= 0) segments.getOrNull(rdAt + 4)?.toIntOrNull()?.takeIf { it >= 0 } else null
            val title = row.optString("title").replace(Regex("https?://[^\\s]+"), "").take(500)
            val filename = row.optJSONObject("behaviorHints")?.optString("filename")?.takeIf { it.isNotBlank() && !it.contains("://") }?.take(500)
            val details = SourceDetails.parse(filename ?: title).copy(kind = SourceDetails.Kind.REAL_DEBRID,
                infoHash = hash, fileIndex = index, filename = filename,
                availability = if (reported && row.optString("name").contains("[RD+]")) SourceDetails.Availability.REPORTED_CACHED else SourceDetails.Availability.UNKNOWN)
            Video.Server("rd:$hash:${index ?: -1}", title.ifBlank { filename ?: "Real-Debrid source" }, details = details)
        }.distinctBy { it.id }
    }
    private suspend fun fetch(url: okhttp3.HttpUrl): String {
        repeat(2) { attempt ->
            try {
                return withTimeout(25_000) {
                    VodHttp.request(Request.Builder().url(url).build()).use { response ->
                        if (!response.isSuccessful) throw IOException("Torrentio search unavailable (HTTP ${response.code}). Use Retry or try later.")
                        VodHttp.text(response)
                    }
                }
            } catch (e: TimeoutCancellationException) {
                if (attempt == 1) throw IOException("Torrentio search timed out. Use Retry.")
            } catch (e: CancellationException) { throw e }
            catch (e: IOException) { if (attempt == 1) throw e }
            delay(750)
        }
        throw IOException("Torrentio search unavailable.")
    }
    suspend fun debrid(type: Video.Type, publish: (List<Video.Server>) -> Unit = {}): Result {
        val imdb = withTimeoutOrNull(20_000) { SourceIdentity.imdb(type) }
            ?: throw IOException("Title identification timed out. Use Retry.")
        val path = when(type) {
            is Video.Type.Movie -> "movie/$imdb"
            is Video.Type.Episode -> {
                if (type.season.number < 0 || type.number < 1) throw IOException("This episode has no valid season/episode number.")
                "series/$imdb:${type.season.number}:${type.number}"
            }
        }
        val reported = RealDebrid.cachedSearchConsent
        val builder = "https://torrentio.strem.fun/".toHttpUrl().newBuilder()
        if (reported) builder.addPathSegment("realdebrid=" + RealDebrid.cachedSearchToken())
        val found = parse(fetch(builder.addPathSegments("stream/$path.json").build()), reported)
        publish(found)
        var cloudFailed = false
        val result = if (VodPreferences.cloudSearch) {
            val enriched = withTimeoutOrNull(15_000) {
                try {
                    val cloud = RealDebrid.cloud().associateBy { it.optString("hash").lowercase() }
                    val permits = Semaphore(3)
                    coroutineScope {
                        found.map { server -> async {
                            val existing = cloud[server.details?.infoHash] ?: return@async server
                            permits.withPermit {
                                try { RealDebrid.verifyCloud(server.copy(details = server.details?.copy(cloudTorrentId = existing.optString("id"))), type) }
                                catch (e: CancellationException) { throw e }
                                catch (_: Exception) { cloudFailed = true; server }
                            }
                        } }.awaitAll()
                    }
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { cloudFailed = true; found }
            }
            if (enriched == null) cloudFailed = true
            enriched ?: found
        } else found
        publish(result)
        val cachedCount = result.count { cached(it.details) }
        val message = when {
            !reported && VodPreferences.cachedOnly && cachedCount == 0 -> "Enable cached search with Torrentio in VOD Settings. ${result.size} torrent candidates found; cached-only hides unverified results."
            result.isEmpty() -> "Torrentio returned no matching torrent sources. Use Retry."
            VodPreferences.cachedOnly && cachedCount == 0 -> "No reported-cached torrents found. Retry or turn off Cached torrents only in VOD Settings to include unverified results."
            else -> "$cachedCount reported-cached or cloud-verified torrents · ${result.size} total torrent candidates"
        } + if (cloudFailed) " · Personal cloud lookup unavailable; other results kept." else ""
        return Result(result, message)
    }
}
