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
        ownedDirs(context).forEach { directory ->
            try {
                if (directory.exists() && !directory.deleteRecursively()) {
                    Log.w(TAG, "Could not clear VOD cache directory: " + directory.name)
                }
            } catch (error: Exception) {
                Log.w(TAG, "VOD cache cleanup skipped: " + directory.name, error)
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
        if (getCacheSize(context) > threshold) {
            Log.i(TAG, "Only VOD-owned caches exceeded the configured limit.")
            clearAppCache(context)
        }
    }
}
