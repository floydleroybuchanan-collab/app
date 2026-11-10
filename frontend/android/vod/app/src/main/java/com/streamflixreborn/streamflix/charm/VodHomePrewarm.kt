package com.streamflixreborn.streamflix.charm

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.bumptech.glide.Glide
import com.bumptech.glide.Priority
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.streamflixreborn.streamflix.models.Category
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.Show
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.utils.HomeCacheStore
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Warms a SMALL first-screen artwork window while the main app is already open.
 * Never blocks startup, the React route, the VOD fragment or the player's decoder.
 * Glide owns the shared bounded cache; this class stores no bitmaps.
 */
object VodHomePrewarm {
    private const val TAG = "CharmVodPrewarm"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val startupStarted = AtomicBoolean(false)
    private val warmLock = Any()
    private var warmJob: Job? = null
    private var lastWarmSignature: String? = null
    private var lastWarmAtMs = 0L
    private const val REWARM_AFTER_MS = 15L * 60L * 1000L

    fun onAppStart(context: Context) {
        if (!startupStarted.compareAndSet(false, true)) return
        val appContext = context.applicationContext
        scope.launch {
            runCatching {
                val provider = UserPreferences.currentProvider ?: return@runCatching
                HomeCacheStore.read(appContext, provider)?.let { warm(appContext, it) }
            }.onFailure { Log.w(TAG, "Could not warm persisted VOD catalog", it) }
        }
    }

    fun warm(context: Context, categories: List<Category>) {
        val appContext = context.applicationContext
        synchronized(warmLock) {
            // Superseded refreshes must not queue more artwork requests.
            warmJob?.cancel()
            warmJob = scope.launch {
                val first = categories.firstOrNull { it.name == Category.FEATURED }
                    ?.list?.filterIsInstance<Show>()?.firstOrNull()
                val hero = when (first) {
                    is Movie -> first.banner ?: first.poster
                    is TvShow -> first.banner ?: first.poster
                    else -> null
                }
                // Front-page shelves only: never prefetch thousands of poster images.
                val posters = categories.asSequence()
                    // Featured is the hero, not the first visible movie shelf.
                    .filter { it.name != Category.FEATURED }
                    .flatMap { it.list.asSequence() }
                    .filterIsInstance<Show>()
                    .mapNotNull {
                        when (it) {
                            is Movie -> it.poster ?: it.banner
                            is TvShow -> it.poster ?: it.banner
                        }
                    }
                    .distinct()
                    .take(10)
                    .toList()
                val requestList = buildList {
                    if (!hero.isNullOrBlank()) add(Triple(hero, 900, 480))
                    posters.filter { it.isNotBlank() && it != hero }
                        .forEach { add(Triple(it, 170, 255)) }
                }
                if (requestList.isEmpty()) return@launch
                val signature = requestList.joinToString(separator = "\u001f") { "${it.first}:${it.second}x${it.third}" }
                val recent = synchronized(warmLock) {
                    signature == lastWarmSignature &&
                        SystemClock.elapsedRealtime() - lastWarmAtMs < REWARM_AFTER_MS
                }
                if (recent) return@launch
                withContext(Dispatchers.Main) {
                    val images = Glide.with(appContext)
                    requestList.forEachIndexed { index, (url, width, height) ->
                        runCatching {
                            images.load(url)
                                .priority(if (index == 0 && !hero.isNullOrBlank()) Priority.HIGH else Priority.NORMAL)
                                .diskCacheStrategy(DiskCacheStrategy.DATA)
                                .preload(width, height)
                        }.onFailure { Log.w(TAG, "VOD artwork preload skipped", it) }
                    }
                }
                synchronized(warmLock) {
                    lastWarmSignature = signature
                    lastWarmAtMs = SystemClock.elapsedRealtime()
                }
            }
        }
    }
}
