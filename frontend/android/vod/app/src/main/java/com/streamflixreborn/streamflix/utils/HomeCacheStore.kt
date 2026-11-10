package com.streamflixreborn.streamflix.utils

import android.content.Context
import android.util.AtomicFile
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonSyntaxException
import com.google.gson.reflect.TypeToken
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.models.Category
import com.streamflixreborn.streamflix.models.Episode
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.Season
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.models.WatchItem
import com.streamflixreborn.streamflix.providers.Provider
import java.io.File

object HomeCacheStore {
    private val gson = Gson()
    // Keep a tiny, access-ordered window of complete VOD catalogs. Very large
    // catalogs remain on disk but are never pinned in RAM beside Live TV/EPG.
    private const val MAX_MEMORY_PROVIDERS = 2
    private const val MAX_MEMORY_ITEMS = 1500
    // Catalog metadata is replaceable; favorite/watch-history data is stored separately.
    // Retain the active provider plus two recently-used provider snapshots, subject to
    // a 24 MiB aggregate budget. An oversized active snapshot is never discarded.
    private const val MAX_DISK_PROVIDERS = 3
    private const val MAX_DISK_BYTES = 24L * 1024L * 1024L
    private val diskLock = Any()
    private val memoryCache = LinkedHashMap<String, List<CachedCategory>>(4, 0.75f, true)

    private fun remember(key: String, payload: List<CachedCategory>) {
        synchronized(memoryCache) {
            if (payload.sumOf { it.list.size } > MAX_MEMORY_ITEMS) {
                memoryCache.remove(key)
                return
            }
            memoryCache[key] = payload
            while (memoryCache.size > MAX_MEMORY_PROVIDERS) {
                val oldest = memoryCache.keys.iterator()
                oldest.next()
                oldest.remove()
            }
        }
    }

    fun clearMemory() {
        synchronized(memoryCache) { memoryCache.clear() }
    }

    private fun forget(key: String) {
        synchronized(memoryCache) { memoryCache.remove(key) }
    }

    fun read(context: Context, provider: Provider): List<Category>? {
        val cacheKey = cacheKey(provider)
        synchronized(memoryCache) { memoryCache[cacheKey] }?.let { payload ->
            return payload.toCategories()
        }

        val file = cacheFile(context, cacheKey)
        return synchronized(diskLock) {
            // A valid .bak may remain if the process died during atomic replacement.
            if (!file.exists() && !File(file.path + ".bak").exists()) return@synchronized null
            runCatching {
                val type = object : TypeToken<List<CachedCategory>>() {}.type
                val payload: List<CachedCategory> = AtomicFile(file).openRead().bufferedReader()
                    .use { reader -> gson.fromJson(reader, type) }
                // Access time is used for bounded disk eviction; only real provider
                // snapshots are stored, never synthesized titles or artwork.
                file.setLastModified(System.currentTimeMillis())
                remember(cacheKey, payload)
                payload.toCategories()
            }.recoverCatching {
                if (it is JsonSyntaxException) {
                    forget(cacheKey)
                    AtomicFile(file).delete()
                }
                null
            }.getOrNull()
        }
    }

    fun write(context: Context, provider: Provider, categories: List<Category>) {
        runCatching {
            val payload = categories.map { CachedCategory.from(it) }
            val cacheKey = cacheKey(provider)
            remember(cacheKey, payload)
            val target = cacheFile(context, cacheKey)
            synchronized(diskLock) {
                target.parentFile?.mkdirs()
                // Stream JSON to AtomicFile to avoid allocating an entire serialized
                // catalog string (and then a second UTF-8 byte array) in RAM.
                val atomic = AtomicFile(target)
                var stream: java.io.FileOutputStream? = null
                try {
                    stream = atomic.startWrite()
                    val writer = stream.writer(Charsets.UTF_8)
                    gson.toJson(payload, writer)
                    writer.flush()
                    atomic.finishWrite(stream)
                } catch (error: Exception) {
                    stream?.let { atomic.failWrite(it) }
                    throw error
                }
                // Housekeeping occurs only after the atomic replacement succeeds.
                // An eviction failure must not roll back a valid catalog snapshot.
                target.setLastModified(System.currentTimeMillis())
                pruneOldCatalogs(context, target)
            }
        }.onFailure { Log.w("CharmVodCache", "Could not persist VOD catalog", it) }
    }

    fun clear(context: Context, provider: Provider) {
        val cacheKey = cacheKey(provider)
        synchronized(diskLock) {
            forget(cacheKey)
            AtomicFile(cacheFile(context, cacheKey)).delete()
        }
    }

    /**
     * Evict only replaceable home catalogs. Never touch user-data-cache,
     * Glide's bounded artwork cache, or the host app's Live TV / EPG files.
     */
    private fun pruneOldCatalogs(context: Context, retained: File) {
        val files = retained.parentFile?.listFiles()
            ?.filter { it.isFile && it.extension == "json" }
            ?.sortedWith(
                compareByDescending<File> { it.absolutePath == retained.absolutePath }
                    .thenByDescending { it.lastModified() }
            ) ?: return
        var count = 0
        var bytes = 0L
        files.forEach { file ->
            val shouldKeep = count == 0 ||
                (count < MAX_DISK_PROVIDERS && bytes + file.length() <= MAX_DISK_BYTES)
            if (shouldKeep) {
                count++
                bytes += file.length()
            } else {
                AtomicFile(file).delete()
                synchronized(memoryCache) {
                    memoryCache.keys.filter { cacheFile(context, it).absolutePath == file.absolutePath }
                        .forEach { memoryCache.remove(it) }
                }
            }
        }
    }

    private fun cacheFile(context: Context, cacheKey: String): File {
        val safeName = cacheKey.replace(Regex("[^a-zA-Z0-9._-]+"), "_")
        return File(context.filesDir, "home-cache/$safeName.json")
    }

    private fun cacheKey(provider: Provider): String {
        val baseUrlKey = provider.baseUrl.trim().trimEnd('/')
        return buildList {
            add(provider.name)
            if (baseUrlKey.isNotEmpty()) {
                add(baseUrlKey)
            }
        }.joinToString("__")
    }

    private fun List<CachedCategory>.toCategories(): List<Category> {
        return mapNotNull { it.toCategoryOrNull() }
    }

    private data class CachedCategory(
        val name: String,
        val list: List<CachedItem>,
    ) {
        fun toCategoryOrNull(): Category? {
            val items = list.mapNotNull { it.toItemOrNull() }
            return Category(name = name, list = items)
        }

        companion object {
            fun from(category: Category): CachedCategory {
                return CachedCategory(
                    name = category.name,
                    list = category.list.mapNotNull(CachedItem::from)
                )
            }
        }
    }

    private data class CachedItem(
        val type: String,
        val id: String,
        val title: String? = null,
        val overview: String? = null,
        val released: String? = null,
        val runtime: Int? = null,
        val trailer: String? = null,
        val quality: String? = null,
        val rating: Double? = null,
        val poster: String? = null,
        val banner: String? = null,
        val episodeNumber: Int? = null,
        val tvShowId: String? = null,
        val tvShowTitle: String? = null,
        val tvShowPoster: String? = null,
        val tvShowBanner: String? = null,
        val seasonId: String? = null,
        val seasonNumber: Int? = null,
        val seasonTitle: String? = null,
        val seasonPoster: String? = null,
        val lastPlaybackPositionMillis: Long? = null,
        val durationMillis: Long? = null,
        val lastEngagementTimeUtcMillis: Long? = null,
    ) {
        fun toItemOrNull(): AppAdapter.Item? {
            val watchHistory =
                if (
                    lastPlaybackPositionMillis != null &&
                    durationMillis != null &&
                    durationMillis > 0 &&
                    lastEngagementTimeUtcMillis != null
                ) {
                    WatchItem.WatchHistory(
                        lastEngagementTimeUtcMillis = lastEngagementTimeUtcMillis,
                        lastPlaybackPositionMillis = lastPlaybackPositionMillis,
                        durationMillis = durationMillis,
                    )
                } else null
            return when (type) {
                "movie" -> Movie(
                    id = id,
                    title = title.orEmpty(),
                    overview = overview,
                    released = released,
                    runtime = runtime,
                    trailer = trailer,
                    quality = quality,
                    rating = rating,
                    poster = poster,
                    banner = banner,
                ).apply {
                    this.watchHistory = watchHistory
                }

                "tv" -> TvShow(
                    id = id,
                    title = title.orEmpty(),
                    overview = overview,
                    released = released,
                    runtime = runtime,
                    trailer = trailer,
                    quality = quality,
                    rating = rating,
                    poster = poster,
                    banner = banner,
                )

                "episode" -> Episode(
                    id = id,
                    number = episodeNumber ?: 0,
                    title = title,
                    released = released,
                    poster = poster,
                    overview = overview,
                    tvShow = tvShowId?.let {
                        TvShow(
                            id = it,
                            title = tvShowTitle.orEmpty(),
                            poster = tvShowPoster,
                            banner = tvShowBanner,
                        )
                    },
                    season = seasonId?.let {
                        Season(
                            id = it,
                            number = seasonNumber ?: 0,
                            title = seasonTitle.orEmpty(),
                            poster = seasonPoster,
                        )
                    }
                ).apply {
                    this.watchHistory = watchHistory
                }

                else -> null
            }
        }

        companion object {
            fun from(item: AppAdapter.Item): CachedItem? {
                return when (item) {
                    is Movie -> CachedItem(
                        type = "movie",
                        id = item.id,
                        title = item.title,
                        overview = item.overview,
                        released = item.released?.format("yyyy-MM-dd"),
                        runtime = item.runtime,
                        trailer = item.trailer,
                        quality = item.quality,
                        rating = item.rating,
                        poster = item.poster,
                        banner = item.banner,
                        lastPlaybackPositionMillis = item.watchHistory?.lastPlaybackPositionMillis,
                        durationMillis = item.watchHistory?.durationMillis,
                        lastEngagementTimeUtcMillis = item.watchHistory?.lastEngagementTimeUtcMillis,
                    )

                    is TvShow -> CachedItem(
                        type = "tv",
                        id = item.id,
                        title = item.title,
                        overview = item.overview,
                        released = item.released?.format("yyyy-MM-dd"),
                        runtime = item.runtime,
                        trailer = item.trailer,
                        quality = item.quality,
                        rating = item.rating,
                        poster = item.poster,
                        banner = item.banner,
                    )

                    is Episode -> CachedItem(
                        type = "episode",
                        id = item.id,
                        title = item.title,
                        overview = item.overview,
                        released = item.released?.format("yyyy-MM-dd"),
                        poster = item.poster,
                        episodeNumber = item.number,
                        tvShowId = item.tvShow?.id,
                        tvShowTitle = item.tvShow?.title,
                        tvShowPoster = item.tvShow?.poster,
                        tvShowBanner = item.tvShow?.banner,
                        seasonId = item.season?.id,
                        seasonNumber = item.season?.number,
                        seasonTitle = item.season?.title,
                        seasonPoster = item.season?.poster,
                        lastPlaybackPositionMillis = item.watchHistory?.lastPlaybackPositionMillis,
                        durationMillis = item.watchHistory?.durationMillis,
                        lastEngagementTimeUtcMillis = item.watchHistory?.lastEngagementTimeUtcMillis,
                    )

                    else -> null
                }
            }
        }
    }
}
