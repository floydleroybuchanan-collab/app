package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.StreamFlixApp
import com.streamflixreborn.streamflix.models.Video
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
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
    val sessionRevision get() = generation
    private val owned = java.util.concurrent.ConcurrentHashMap<String, String>()
    val connected get() = vault.read()?.optString("access_token")?.isNotBlank() == true
    val accountLabel get() = vault.read()?.let { data ->
        data.optString("label") + data.optString("expiration").takeIf { it.isNotBlank() }?.let { " · Expires " + it.take(10) }.orEmpty()
    } ?: "Not connected"
    val deviceLabel get() = vault.read()?.optString("device_label")?.takeIf { it.isNotBlank() } ?: "CharmIPTV"
    private val oauth = DebridOAuth()
    suspend fun setLabel(label: String) = authLock.withLock {
        vault.read()?.let { vault.write(it.put("device_label", label.filter { c -> !c.isISOControl() }.take(80).ifBlank { "CharmIPTV" })) }
    }
    private fun account(data: JSONObject, user: JSONObject): JSONObject = data
        .put("label", user.optString("username", "Connected") + " · " + user.optString("type", "account"))
        .put("expiration", user.optString("expiration"))
    suspend fun connectOAuth(data: JSONObject, expectedRevision: Long) {
        val user = JSONObject(api("user", token = data.getString("access_token")))
        coroutineContext.ensureActive()
        authLock.withLock {
            coroutineContext.ensureActive()
            if (generation != expectedRevision) throw IOException("Account changed. Start linking again.")
            vault.write(account(data, user).put("device_label", "CharmIPTV"))
            generation++; owned.clear()
        }
    }
    suspend fun refreshAccount() {
        val (epoch, token) = credentials()
        val user = JSONObject(api("user", token = token, epoch = epoch))
        authLock.withLock {
            checkSession(epoch)
            vault.read()?.let { vault.write(account(it, user)) }
        }
    }
    private suspend fun refreshLocked(data: JSONObject): JSONObject {
        if (data.optString("auth_mode") != "oauth") throw IOException("Reconnect your Real-Debrid account.")
        val refreshed = oauth.token(data.getString("client_id"), data.getString("client_secret"), data.getString("refresh_token"))
        coroutineContext.ensureActive()
        refreshed.keys().forEach { key -> data.put(key, refreshed.get(key)) }
        vault.write(data)
        return data
    }

    suspend fun connectToken(token: String) = authLock.withLock {
        val checked = DebridInput.token(token)
        val user = JSONObject(api("user", token = checked))
        coroutineContext.ensureActive()
        vault.write(account(JSONObject().put("access_token", checked).put("auth_mode", "personal"), user))
        generation++
        owned.clear()
    }

    suspend fun disconnect() = authLock.withLock {
        generation++
        owned.clear()
        vault.clear()
    }

    private suspend fun credentials(): Pair<Long, String> = authLock.withLock {
        var data = vault.read() ?: throw IOException("Connect your Real-Debrid account in VOD Settings.")
        if (data.optString("auth_mode") == "oauth" && data.optLong("expires_at") <= System.currentTimeMillis() + 60000)
            data = refreshLocked(data)
        generation to data.getString("access_token")
    }

    private class ApiFailure(val status: Int, message: String) : IOException(message)
    private suspend fun api(path: String, fields: Map<String, String>? = null, token: String, epoch: Long? = null): String {
        try { return rawApi(path, fields, token) }
        catch (error: ApiFailure) {
            if (error.status != 401 || epoch == null) throw error
            val refreshed = authLock.withLock {
                checkSession(epoch)
                val data = vault.read() ?: throw error
                if (data.optString("access_token") == token) refreshLocked(data).getString("access_token")
                else data.getString("access_token")
            }
            // Confirmed unauthorized requests did not perform the operation.
            checkSession(epoch)
            return rawApi(path, fields, refreshed)
        }
    }
    private suspend fun rawApi(path: String, fields: Map<String, String>?, token: String): String {
        repeat(3) { attempt ->
            val builder = Request.Builder().url("https://api.real-debrid.com/rest/1.0/$path")
                .header("Authorization", "Bearer $token")
            fields?.let { data -> builder.post(FormBody.Builder().apply { data.forEach { (k,v) -> add(k,v) } }.build()) }
            VodHttp.request(builder.build()).use { response ->
                // Retry reads only. A timed-out POST may have already added the torrent.
                if (fields == null && (response.code == 429 || response.code >= 500) && attempt < 2) {
                    delay((response.header("Retry-After")?.toLongOrNull()?.coerceIn(1, 30) ?: (2L shl attempt)) * 1000)
                } else {
                    if (!response.isSuccessful) {
                        val code = runCatching { JSONObject(VodHttp.text(response)).optInt("error_code") }.getOrDefault(0)
                        throw ApiFailure(response.code, DebridErrors.message(response.code, code))
                    }
                    return VodHttp.text(response)
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
            val data = JSONArray(api("torrents?limit=100&page=$page", token = token, epoch = epoch))
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
        val info = JSONObject(api("torrents/info/$id", token = token, epoch = epoch))
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

    suspend fun resolveHost(server: Video.Server): Video {
        val link = server.details?.originalHostUrl ?: throw IOException("Missing original host link.")
        if (!DebridHosts.eligible(link, DebridHosts.supported())) throw IOException("This host is not supported by Real-Debrid.")
        val (epoch, token) = credentials()
        val check = JSONObject(api("unrestrict/check", mapOf("link" to link), token, epoch))
        if (check.optInt("supported", 1) == 0) throw IOException("This host link is unavailable. Try its direct source.")
        checkSession(epoch)
        val result = JSONObject(api("unrestrict/link", mapOf("link" to link), token, epoch))
        checkSession(epoch)
        val url = result.optString("download").toHttpUrlOrNull()
        if (url == null || !url.isHttps) throw IOException("Real-Debrid did not return a secure playback link.")
        return Video(source = url.toString())
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
            id = JSONObject(api("torrents/addMagnet", mapOf("magnet" to "magnet:?xt=urn:btih:$hash"), token, epoch)).getString("id")
            authLock.withLock {
                checkSession(epoch)
                if (owned.size < 100) owned[hash] = id
            }
            created = true
        }
        require(id.matches(Regex("[A-Za-z0-9_-]+")))
        repeat(20) {
            checkSession(epoch)
            val info = JSONObject(api("torrents/info/$id", token = token, epoch = epoch))
            checkSession(epoch)
            val files = info.optJSONArray("files") ?: JSONArray()
            val candidates = (0 until files.length()).map { files.getJSONObject(it) }
            val file = TorrentFiles.choose(candidates.map {
                TorrentFiles.File(it.getInt("id"), it.getString("path"), it.optLong("bytes"), it.optInt("selected") == 1)
            }, detail.fileIndex, type)
            when (info.optString("status")) {
                "waiting_files_selection" -> {
                    if (!created) throw IOException("Choose files for this existing torrent in your Real-Debrid account.")
                    if (file == null) throw IOException("No unambiguous video file matches this title or episode.")
                    api("torrents/selectFiles/$id", mapOf("files" to file.id.toString()), token, epoch)
                }
                "downloaded" -> {
                    if (file == null || !file.selected) throw IOException("The requested video is not selected in this cloud torrent.")
                    val selected = candidates.filter { it.optInt("selected") == 1 }
                    val index = selected.indexOfFirst { it.getInt("id") == file.id }
                    val link = info.optJSONArray("links")?.optString(index).orEmpty()
                    if (link.isBlank()) throw IOException("The requested video has no playable cloud link.")
                    val result = JSONObject(api("unrestrict/link", mapOf("link" to link), token, epoch))
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
