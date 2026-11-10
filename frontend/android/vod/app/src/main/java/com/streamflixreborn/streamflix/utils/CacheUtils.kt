package com.streamflixreborn.streamflix.utils

import android.content.Context
import android.util.Log
import java.io.File

/**
 * VOD now shares the MAIN Charming MediaLab process.
 * Clearing the root application cache or global Glide/WebView caches would
 * destroy Live TV's EPG, logos, authenticated HTTP and preview state.
 * VOD clears only its own transient metadata/artwork directory.
 */
object CacheUtils {
    private const val TAG = "VodCacheUtils"

    private fun ownedDirs(context: Context): List<File> {
        val app = context.applicationContext
        return listOf(
            File(app.cacheDir, "vod"),
            File(app.filesDir, "home-cache"),
        )
    }

    fun clearAppCache(context: Context) {
        // Clear the same metadata from memory BEFORE deleting the backing JSON.
        // Do not evict shared Live TV, logo, EPG or WebView caches.
        HomeCacheStore.clearMemory()
        val app = context.applicationContext
        val vod = File(app.cacheDir, "vod")
        // The HTTP artwork cache is an OPEN, journal-backed OkHttp Cache.
        // Deleting its files while its Cache instance is active corrupts the
        // journal and can break subsequent authenticated poster requests.
        // Clear replaceable metadata and the in-memory home snapshot, but
        // leave that managed bounded 10 MiB cache to its own LRU eviction.
        val replaceable = buildList {
            add(File(app.filesDir, "home-cache"))
            vod.listFiles()?.filterTo(this) { it.name != "glide-okhttp-cache" }
        }
        replaceable.forEach { directory ->
            try {
                if (directory.exists() && !directory.deleteRecursively()) {
                    Log.w(TAG, "Could not clear VOD metadata: " + directory.name)
                }
            } catch (error: Exception) {
                Log.w(TAG, "VOD metadata cleanup skipped: " + directory.name, error)
            }
        }
        // Do NOT call Glide.clearMemory(), Glide.clearDiskCache(),
        // WebView.clearCache() or context.cacheDir.deleteRecursively() here.
        // Their caches belong to the host and may be in active use.
    }

    fun getCacheSize(context: Context): Long = ownedDirs(context).sumOf { folderSize(it) }

    private fun folderSize(file: File?): Long {
        if (file == null || !file.exists()) return 0L
        if (!file.isDirectory) return file.length()
        return file.listFiles()?.sumOf { folderSize(it) } ?: 0L
    }

    fun autoClearIfNeeded(context: Context, thresholdMb: Long = 50L) {
        val threshold = thresholdMb.coerceAtLeast(10L) * 1024 * 1024
        val managed = File(context.applicationContext.cacheDir, "vod")
        // The unified app uses an OPEN, bounded OkHttp artwork cache at
        // vod/glide-okhttp-cache. Deleting its parent directory at startup
        // invalidates that journal and forces genuine artwork to redownload;
        // the old 10 MiB TV threshold could trigger this repeatedly.
        //
        // Managed Glide/OkHttp caches evict by their configured disk budgets.
        // Leave them alone while the app is running. The independent
        // home-cache JSON snapshots have a separate bounded LRU.
        if (folderSize(managed) > threshold) {
            Log.i(TAG, "VOD managed image cache exceeds housekeeping threshold; " +
                "preserving active bounded HTTP cache instead of deleting its journal")
        }
    }
}
