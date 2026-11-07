package com.streamflixreborn.streamflix.utils

import android.content.Context
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
import java.util.LinkedHashMap

object HomeCacheStore {
    private val gson = Gson()
    private const val MAX_FILE_BYTES = 4 * 1024 * 1024
    private const val MAX_MEMORY_PROVIDERS = 2
    private const val CACHE_TTL_MS = 6L * 60 * 60 * 1000
    private val memoryCache = LinkedHashMap<String, Pair<Long, String>>(4, .75f, true)
    private val memoryLock = Any()
    private val ioLock = Any()
    private var memoryEpoch = 0L
    fun trimMemory() = synchronized(memoryLock) { memoryEpoch++; memoryCache.clear() }
    fun clearDiskCache(context: Context) = synchronized(ioLock) {
        trimMemory()
        File(context.filesDir, "home-cache").listFiles()?.filter { it.isFile && it.extension == "json" }?.forEach { it.delete() }
    }
    private fun remember(key: String, json: String, writtenAt: Long, epoch: Long) = synchronized(memoryLock) {
        if (epoch != memoryEpoch) return@synchronized
        memoryCache[key] = writtenAt to json
        while (memoryCache.size > MAX_MEMORY_PROVIDERS) memoryCache.remove(memoryCache.keys.first())
    }
    private fun recalled(key: String): String? = synchronized(memoryLock) {
        val entry = memoryCache[key] ?: return null
        if (System.currentTimeMillis() - entry.first > CACHE_TTL_MS) { memoryCache.remove(key); return null }
        entry.second
    }
    private fun forget(key: String) = synchronized(memoryLock) { memoryCache.remove(key) }

    fun read(context: Context, provider: Provider): List<Category>? = synchronized(ioLock) {
        val epoch = synchronized(memoryLock) { memoryEpoch }
        val cacheKey = cacheKey(provider)
        val file = cacheFile(context, cacheKey)
        runCatching {
            val json = recalled(cacheKey) ?: run {
                if (!file.exists() || file.length() > MAX_FILE_BYTES || System.currentTimeMillis() - file.lastModified() > CACHE_TTL_MS) return null
                // Bound the actual read too, in case the file grows after stat.
                val bytes = file.inputStream().use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > MAX_FILE_BYTES) return null
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                bytes.toString(Charsets.UTF_8)
            }
            val type = object : TypeToken<List<CachedCategory>>() {}.type
            val payload: List<CachedCategory> = gson.fromJson(json, type)
            remember(cacheKey, json, file.lastModified(), epoch)
            payload.toCategories()
        }.recoverCatching {
            if (it is JsonSyntaxException) {
                forget(cacheKey)
                file.delete()
            }
            null
        }.getOrNull()
    }

    fun write(context: Context, provider: Provider, categories: List<Category>): Unit = synchronized(ioLock) {
        val epoch = synchronized(memoryLock) { memoryEpoch }
        runCatching {
            val payload = categories.map { CachedCategory.from(it) }
            val cacheKey = cacheKey(provider)
            val json = gson.toJson(payload)
            if (json.length > MAX_FILE_BYTES || json.toByteArray(Charsets.UTF_8).size > MAX_FILE_BYTES) {
                forget(cacheKey)
                cacheFile(context, cacheKey).delete()
                return@synchronized
            }
            remember(cacheKey, json, System.currentTimeMillis(), epoch)
            cacheFile(context, cacheKey).apply {
                parentFile?.mkdirs()
                writeText(json)
            }
            val files = File(context.filesDir, "home-cache").listFiles()?.filter { it.isFile && it.extension == "json" }?.sortedByDescending { it.lastModified() }.orEmpty()
            var retainedBytes = 0L
            files.forEachIndexed { index, file ->
                retainedBytes += file.length()
                if (index >= 16 || retainedBytes > 32L * 1024 * 1024) file.delete()
            }
        }
        Unit
    }

    fun clear(context: Context, provider: Provider) = synchronized(ioLock) {
        val cacheKey = cacheKey(provider)
        forget(cacheKey)
        cacheFile(context, cacheKey).delete()
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
