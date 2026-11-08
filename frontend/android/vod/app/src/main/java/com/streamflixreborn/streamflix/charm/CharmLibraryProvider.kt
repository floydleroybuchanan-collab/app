package com.streamflixreborn.streamflix.charm

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.database.AppDatabase
import com.streamflixreborn.streamflix.models.*
import com.streamflixreborn.streamflix.utils.ParentalControlUtils
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject

/** Private, read-only IPC: provider selection and Room stay in the VOD process. */
class CharmLibraryProvider : ContentProvider() {
    override fun onCreate() = true
    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        check(android.os.Binder.getCallingUid() == android.os.Process.myUid())
        // A newly authenticated account must never see another account's
        // native Room recently-watched and favorites data across processes.
        if (!CharmVodAccountScope.activateVerifiedPrefix(extras?.getString("historyPrefix")))
            return Bundle().apply { putString("items", "[]") }
        return runBlocking(Dispatchers.IO) {
            withTimeout(20_000) {
                val provider = UserPreferences.currentProvider
                val items: List<AppAdapter.Item> = when {
                    provider == null -> emptyList()
                    method == "search" -> if (arg.isNullOrBlank()) emptyList() else provider.search(arg.take(200))
                    method == "favorites" -> AppDatabase.getInstance(requireNotNull(context)).let {
                        it.movieDao().getFavoriteShelf(30) + it.tvShowDao().getFavoriteShelf(30)
                    }
                    method == "continue" -> AppDatabase.getInstance(requireNotNull(context)).let {
                        // "Recently watched" starts as soon as playback starts, while
                        // resumable progress is written when playback pauses. Include
                        // both so a short play, crash, or immediate return cannot make
                        // the title disappear from MediaLab's home shelf.
                        val candidates: List<AppAdapter.Item> =
                            it.movieDao().getWatchingShelf(30) +
                            it.episodeDao().getWatchingShelf(30) +
                            it.movieDao().getRecentlyWatched().first() +
                            it.tvShowDao().getRecentlyWatched().first()
                        candidates.distinctBy { item ->
                            when (item) {
                                is Movie -> "movie:${item.id}"
                                is Episode -> "show:${item.tvShow?.id ?: item.id}"
                                is TvShow -> "show:${item.id}"
                                else -> item.toString()
                            }
                        }.sortedByDescending { item ->
                            when (item) {
                                is Movie -> maxOf(item.lastPlayedAtMillis ?: 0, item.watchHistory?.lastEngagementTimeUtcMillis ?: 0)
                                is Episode -> item.watchHistory?.lastEngagementTimeUtcMillis ?: 0
                                is TvShow -> item.lastPlayedAtMillis ?: 0
                                else -> 0
                            }
                        }
                    }
                    else -> emptyList()
                }
                val result = JSONArray()
                for (item in ParentalControlUtils.filterItems(items.take(30))) {
                    val value = when(item) {
                        is Movie -> JSONObject().put("id", item.id).put("title", item.title).put("poster", item.poster).put("section", "movie:" + item.id)
                        is TvShow -> JSONObject().put("id", item.id).put("title", item.title).put("poster", item.poster).put("section", "show:" + item.id)
                        is Episode -> item.tvShow?.let { show -> JSONObject().put("id", item.id).put("title", show.title + " · " + (item.title ?: "Episode " + item.number)).put("poster", show.poster).put("section", "show:" + show.id) }
                        else -> null
                    }
                    if (value != null) result.put(value)
                }
                Bundle().apply { putString("items", result.toString()) }
            }
        }
    }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
}
