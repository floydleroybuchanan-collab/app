package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.StreamFlixApp
import com.streamflixreborn.streamflix.models.Video
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.FormBody
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/** Uses only the documented public API. Discovery never adds torrents to a user's account. */
object RealDebrid {
    private val vault by lazy { DebridVault(StreamFlixApp.instance) }
    private val authLock = Mutex()
    @Volatile private var generation = 0L
    private val owned = java.util.concurrent.ConcurrentHashMap<String, String>()
    val connected get() = vault.read()?.optString("access_token")?.isNotBlank() == true
    val accountLabel get() = vault.read()?.optString("label") ?: "Not connected"

    suspend fun connectToken(token: String) = authLock.withLock {
        require(token.trim().isNotEmpty()) { "Enter your personal Real-Debrid API token." }
        val user = JSONObject(api("user", token = token.trim()))
        vault.write(JSONObject().put("access_token", token.trim()).put("label",
            "${user.optString("username", "Connected")} · ${user.optString("type", "account")}"))
        generation++
        owned.clear()
    }

    suspend fun disconnect() = authLock.withLock {
        generation++
        owned.clear()
        vault.clear()
    }

    private fun credentials(): Pair<Long, String> =
        generation to (vault.read()?.optString("access_token")?.takeIf { it.isNotBlank() }
            ?: throw IOException("Connect your Real-Debrid account in VOD Settings."))

    private suspend fun api(path: String, fields: Map<String, String>? = null, token: String): String {
        repeat(3) { attempt ->
            val builder = Request.Builder().url("https://api.real-debrid.com/rest/1.0/$path")
                .header("Authorization", "Bearer $token")
            fields?.let { data -> builder.post(FormBody.Builder().apply { data.forEach { (k,v) -> add(k,v) } }.build()) }
            VodHttp.request(builder.build()).use { response ->
                // Retry reads only. A timed-out POST may have already added the torrent.
                if (fields == null && (response.code == 429 || response.code >= 500) && attempt < 2) {
                    delay((response.header("Retry-After")?.toLongOrNull()?.coerceIn(1, 30) ?: (2L shl attempt)) * 1000)
                } else {
                    if (!response.isSuccessful) throw IOException(when (response.code) {
                        401 -> "Real-Debrid login expired. Reconnect in VOD Settings."
                        403 -> "Real-Debrid denied access. Check your account and premium status."
                        429 -> "Real-Debrid is busy. Wait a moment before trying again."
                        else -> "Real-Debrid could not complete this request (HTTP ${response.code})."
                    })
                    return response.body?.string().orEmpty()
                }
            }
        }
        throw IOException("Real-Debrid is temporarily unavailable.")
    }

    suspend fun cloud(): List<JSONObject> {
        val (epoch, token) = credentials()
        val items = mutableListOf<JSONObject>()
        // Bounded account scan; older entries not scanned remain explicitly unverified.
        for (page in 1..5) {
            val data = JSONArray(api("torrents?limit=100&page=$page", token = token))
            checkSession(epoch)
            for (i in 0 until data.length()) items += data.getJSONObject(i)
            if (data.length() < 100) break
        }
        return items
    }

    private fun checkSession(epoch: Long) {
        if (epoch != generation || !connected) throw IOException("Real-Debrid account changed. Select the source again.")
    }

    suspend fun verifyCloud(server: Video.Server, type: Video.Type): Video.Server {
        val details = server.details ?: return server
        val id = details.cloudTorrentId?.takeIf { it.matches(Regex("[A-Za-z0-9_-]+")) } ?: return server
        val (epoch, token) = credentials()
        val info = JSONObject(api("torrents/info/$id", token = token))
        checkSession(epoch)
        if (info.optString("status") != "downloaded") return server
        val files = info.optJSONArray("files") ?: return server
        val selected = TorrentFiles.choose((0 until files.length()).map {
            val f = files.getJSONObject(it)
            TorrentFiles.File(f.getInt("id"), f.getString("path"), f.optLong("bytes"), f.optInt("selected") == 1)
        }, details.fileIndex, type)
        return if (selected?.selected == true) server.copy(details = details.copy(
            availability = SourceDetails.Availability.READY, bytes = selected.bytes)) else server
    }

    suspend fun resolve(server: Video.Server, type: Video.Type): Video {
        val detail = requireNotNull(server.details)
        val hash = detail.infoHash?.lowercase()?.takeIf { it.matches(Regex("[a-f0-9]{40}")) }
            ?: throw IOException("This torrent has no valid info hash.")
        val (epoch, token) = credentials()
        var id = detail.cloudTorrentId ?: owned[hash]
        var created = id != null && owned[hash] == id
        if (id == null) {
            checkSession(epoch)
            id = JSONObject(api("torrents/addMagnet", mapOf("magnet" to "magnet:?xt=urn:btih:$hash"), token)).getString("id")
            if (owned.size < 100) owned[hash] = id
            created = true
        }
        require(id.matches(Regex("[A-Za-z0-9_-]+")))
        repeat(20) {
            checkSession(epoch)
            val info = JSONObject(api("torrents/info/$id", token = token))
            val files = info.optJSONArray("files") ?: JSONArray()
            val candidates = (0 until files.length()).map { files.getJSONObject(it) }
            val file = TorrentFiles.choose(candidates.map {
                TorrentFiles.File(it.getInt("id"), it.getString("path"), it.optLong("bytes"), it.optInt("selected") == 1)
            }, detail.fileIndex, type)
            when (info.optString("status")) {
                "waiting_files_selection" -> {
                    if (!created) throw IOException("Choose files for this existing torrent in your Real-Debrid account.")
                    if (file == null) throw IOException("No unambiguous video file matches this title or episode.")
                    api("torrents/selectFiles/$id", mapOf("files" to file.id.toString()), token)
                }
                "downloaded" -> {
                    if (file == null || !file.selected) throw IOException("The requested video is not selected in this cloud torrent.")
                    val selected = candidates.filter { it.optInt("selected") == 1 }
                    val index = selected.indexOfFirst { it.getInt("id") == file.id }
                    val link = info.optJSONArray("links")?.optString(index).orEmpty()
                    if (link.isBlank()) throw IOException("The requested video has no playable cloud link.")
                    val result = JSONObject(api("unrestrict/link", mapOf("link" to link), token))
                    checkSession(epoch)
                    val url = result.optString("download")
                    if (!url.startsWith("https://")) throw IOException("Real-Debrid did not return a secure playback URL.")
                    return Video(source = url)
                }
                "magnet_error", "error", "virus", "dead" -> throw IOException("This torrent is unavailable. Choose another source.")
            }
            delay(2000)
        }
        throw IOException("Real-Debrid is still preparing this video. Try it again later from Sources.")
    }
}
