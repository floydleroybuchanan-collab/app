package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.StreamFlixApp
import com.streamflixreborn.streamflix.database.AppDatabase
import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.models.WatchItem
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.UserDataCache
import java.util.Calendar

object VodHistory {
    private val database get() = AppDatabase.getInstance(StreamFlixApp.instance)
    fun resume(type: Video.Type): Long = when (type) {
        is Video.Type.Movie -> database.movieDao().getById(type.id)?.watchHistory?.lastPlaybackPositionMillis
        is Video.Type.Episode -> database.episodeDao().getById(type.id)?.watchHistory?.lastPlaybackPositionMillis
    }?.let { (it - 10_000).coerceAtLeast(0) } ?: 0

    fun save(type: Video.Type, position: Long, duration: Long, complete: Boolean = false) {
        if (position <= 0 || duration <= 0) return
        val provider = UserPreferences.currentProvider ?: return
        fun update(item: WatchItem) {
            item.isWatched = complete
            item.watchedDate = if (complete) Calendar.getInstance() else null
            item.watchHistory = if (complete) null else WatchItem.WatchHistory(System.currentTimeMillis(), position, duration)
        }
        when (type) {
            is Video.Type.Movie -> database.movieDao().getById(type.id)?.let {
                update(it); database.movieDao().update(it); UserDataCache.syncMovieToCache(StreamFlixApp.instance, provider, it)
            }
            is Video.Type.Episode -> database.episodeDao().getById(type.id)?.let {
                update(it); database.episodeDao().update(it); UserDataCache.syncEpisodeToCache(StreamFlixApp.instance, provider, it)
                database.tvShowDao().getById(type.tvShow.id)?.let { show ->
                    val updated = show.copy().apply {
                        merge(show)
                        isWatching = !complete || database.episodeDao().hasAnyWatchHistoryForTvShow(show.id)
                    }
                    database.tvShowDao().update(updated)
                    UserDataCache.syncTvShowToCache(StreamFlixApp.instance, provider, updated)
                }
            }
        }
    }
}
