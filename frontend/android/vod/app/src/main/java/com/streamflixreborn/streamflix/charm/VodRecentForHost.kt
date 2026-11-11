package com.streamflixreborn.streamflix.charm

import android.content.Context
import com.streamflixreborn.streamflix.database.AppDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * Recently watched VOD titles for Charming MediaLab's Live TV screen.
 *
 * Read-only. Uses the same Room queries (and the same per-provider database)
 * as VOD Home's own "Recently Watched" row, so Live TV never shows titles VOD
 * itself would not. Each query is already capped at 10 rows; only ids, titles
 * and one artwork URL leave this function (no full models are kept).
 * Call from a background thread.
 */
object VodRecentForHost {
    class Entry(
        val id: String,
        val kind: String,
        val title: String,
        val image: String?,
        val playedAt: Long,
        val progress: Int,
    )

    fun read(context: Context, limit: Int): List<Entry> {
        val db = AppDatabase.getInstance(context.applicationContext)
        val movies = runBlocking { db.movieDao().getRecentlyWatched().first() }
        val shows = runBlocking { db.tvShowDao().getRecentlyWatched().first() }
        val out = ArrayList<Entry>(movies.size + shows.size)
        for (movie in movies) {
            val at = movie.lastPlayedAtMillis ?: continue
            val history = movie.watchHistory
            val progress = when {
                history != null && history.durationMillis > 0 ->
                    ((history.lastPlaybackPositionMillis * 100) / history.durationMillis).toInt().coerceIn(0, 100)
                movie.isWatched -> 100
                else -> 0
            }
            out += Entry(movie.id, "movie", movie.title, movie.banner ?: movie.poster, at, progress)
        }
        for (show in shows) {
            val at = show.lastPlayedAtMillis ?: continue
            out += Entry(show.id, "tv_show", show.title, show.banner ?: show.poster, at, 0)
        }
        out.sortByDescending { it.playedAt }
        return if (out.size > limit) out.subList(0, limit) else out
    }
}
