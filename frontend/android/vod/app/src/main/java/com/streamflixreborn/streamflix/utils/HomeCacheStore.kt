package com.streamflixreborn.streamflix.utils

import android.content.Context
import com.google.gson.Gson
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
    private const val MAX_MEMORY_PROVIDERS = 2
    private const val MAX_CACHE_ITEMS = 2000
    private const val MAX_SNAPSHOT_BYTES = 8L * 1024 * 1024
    private const val MAX_DISK_BYTES = 32L * 1024 * 1024
    private const val MAX_DISK_FILES = 8
    private val cacheLock = Any()
    private val memoryLock = Any()
    private val memoryCache = object : LinkedHashMap<String, List<CachedCategory>>(4, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<CachedCategory>>?) = size > MAX_MEMORY_PROVIDERS
    }

    fun read(context: Context, provider: Provider): List<Category>? = synchronized(cacheLock) {
        val key = cacheKey(provider)
        synchronized(memoryLock) { memoryCache[key] }?.let { return@synchronized it.toCategories() }
        val file = cacheFile(context, key)
        if (file.length() > MAX_SNAPSHOT_BYTES) return@synchronized null
        runCatching {
            val text = android.util.AtomicFile(file).openRead().use { input ->
                if (input.channel.size() > MAX_SNAPSHOT_BYTES) return@synchronized null
                input.bufferedReader().readText()
            }
            val type = object : TypeToken<List<CachedCategory>>() {}.type
            val payload: List<CachedCategory> = gson.fromJson(text, type)
            if (payload.sumOf { it.list.size } > MAX_CACHE_ITEMS) return@synchronized null
            synchronized(memoryLock) { memoryCache[key] = payload }
            payload.toCategories()
        }.getOrNull()
    }

    fun write(context: Context, provider: Provider, categories: List<Category>) {
        // Skip caching oversized catalogs; never truncate the actual catalog or
        // touch saved favorites/history. The live response remains available.
        if (categories.sumOf { it.list.size } > MAX_CACHE_ITEMS) return
        val payload = categories.map { CachedCategory.from(it) }
        val bytes = gson.toJson(payload).toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_SNAPSHOT_BYTES) return
        synchronized(cacheLock) {
            val key = cacheKey(provider)
            val file = cacheFile(context, key)
            file.parentFile?.mkdirs()
            val atomic = android.util.AtomicFile(file)
            var stream: java.io.FileOutputStream? = null
            try {
                stream = atomic.startWrite()
                stream.write(bytes)
                atomic.finishWrite(stream)
                synchronized(memoryLock) { memoryCache[key] = payload }
                // Only reloadable snapshots in our own directory are eligible.
                var total = 0L
                file.parentFile?.listFiles { entry -> entry.isFile && entry.extension == "json" }
                    ?.sortedByDescending { it.lastModified() }?.forEachIndexed { index, entry ->
                        total += entry.length()
                        if (index >= MAX_DISK_FILES || total > MAX_DISK_BYTES) entry.delete()
                    }
            } catch (_: Exception) { atomic.failWrite(stream) }
        }
    }

    fun clearMemory() = synchronized(memoryLock) { memoryCache.clear() }

    fun clear(context: Context, provider: Provider) = synchronized(cacheLock) {
        val key = cacheKey(provider)
        synchronized(memoryLock) { memoryCache.remove(key) }
        android.util.AtomicFile(cacheFile(context, key)).delete()
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
