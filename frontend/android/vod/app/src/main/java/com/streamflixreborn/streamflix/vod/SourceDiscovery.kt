package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.models.Video
import kotlinx.coroutines.CancellationException
import okhttp3.Request
import org.json.JSONObject

object SourceDiscovery {
    suspend fun debrid(type: Video.Type): List<Video.Server> {
        val imdb = when (type) {
            is Video.Type.Movie -> type.imdbId
            is Video.Type.Episode -> type.tvShow.imdbId
        }?.takeIf { it.matches(Regex("tt[0-9]+")) } ?: return emptyList()
        val path = when (type) {
            is Video.Type.Movie -> "movie/$imdb"
            is Video.Type.Episode -> "series/$imdb:${type.season.number}:${type.number}"
        }
        // Only public title identifiers leave the device. Never put RD credentials in an addon URL.
        val body = VodHttp.request(Request.Builder()
            .url("https://torrentio.strem.fun/stream/$path.json").build()).use {
            if (!it.isSuccessful) throw java.io.IOException("Torrent source search is unavailable (HTTP ${it.code}).")
            val data = it.body ?: return emptyList()
            if (data.contentLength() > 2_000_000) throw java.io.IOException("Source response is too large.")
            val buffer = data.source()
            buffer.request(2_000_001)
            if (buffer.buffer.size > 2_000_000) throw java.io.IOException("Source response is too large.")
            data.string()
        }
        val streams = JSONObject(body).optJSONArray("streams") ?: return emptyList()
        val cloud = try { RealDebrid.cloud() } catch (e: CancellationException) { throw e }
            catch (_: Exception) { emptyList() }
        val result = (0 until minOf(streams.length(), 100)).mapNotNull { i ->
            val row = streams.optJSONObject(i) ?: return@mapNotNull null
            val hash = row.optString("infoHash").lowercase()
                .takeIf { it.matches(Regex("[a-f0-9]{40}")) } ?: return@mapNotNull null
            val index = if (row.has("fileIdx") && !row.isNull("fileIdx")) row.optInt("fileIdx").takeIf { it >= 0 } else null
            val title = row.optString("title").take(500)
            val filename = row.optJSONObject("behaviorHints")?.optString("filename")?.takeIf { it.isNotBlank() }
            val existing = cloud.firstOrNull { it.optString("hash").equals(hash, true) }
            val details = SourceDetails.parse(filename ?: title).copy(kind = SourceDetails.Kind.REAL_DEBRID,
                infoHash = hash, fileIndex = index, filename = filename, cloudTorrentId = existing?.optString("id"),
                // A downloaded pack does not establish that this particular file is selected.
                availability = if (existing != null && existing.optString("status") != "downloaded")
                    SourceDetails.Availability.PREPARING else SourceDetails.Availability.UNKNOWN)
            Video.Server("rd:$hash:${index ?: -1}", title.ifBlank { filename ?: "Real-Debrid source" },
                details = details)
        }.distinctBy { it.id }
        var verified = 0
        return result.map { server ->
            if (server.details?.cloudTorrentId != null && verified++ < 20) {
                try { RealDebrid.verifyCloud(server, type) }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { server }
            } else server
        }
    }
}
