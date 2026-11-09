package com.streamflixreborn.streamflix.utils

import android.content.ComponentCallbacks2
import android.content.Context
import android.util.Log
import com.bumptech.glide.Glide
import com.streamflixreborn.streamflix.charm.CharmVodProcess
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * A VOD-only cache policy. Never recursively delete applicationContext.cacheDir
 * in Charming MediaLab: that directory also contains the EPG/logo/HTTP caches.
 * Database, playlists and watch history are outside the ephemeral VOD cache.
 */
object CacheUtils {
    private const val TAG = "VodCache"
    private const val MAX_DELETE_DEPTH = 12
    private val pruning = AtomicBoolean(false)

    private fun internalVodCache(context: Context): File {
        val base = context.applicationContext.cacheDir
        return if (CharmVodProcess.isVod) base else File(base, "vod")
    }

    private fun externalVodCache(context: Context): File? =
        context.applicationContext.externalCacheDir?.let {
            if (CharmVodProcess.isVod) it else File(it, "vod")
        }

    fun getCacheSize(context: Context): Long =
        sizeOf(internalVodCache(context), 0) + sizeOf(externalVodCache(context), 0)

    private fun sizeOf(root: File?, depth: Int): Long {
        if (root == null || !root.exists() || depth > MAX_DELETE_DEPTH) return 0L
        if (!root.isDirectory) return root.length()
        return root.listFiles()?.sumOf { sizeOf(it, depth + 1) } ?: 0L
    }

    private fun clearDirectory(root: File?) {
        if (root == null || !root.isDirectory) return
        // Only clear children of the VOD-owned namespace. Never delete the
        // namespace itself, host cache root, guide, or app databases.
        root.listFiles()?.forEach { entry ->
            if (!entry.deleteRecursively()) Log.w(TAG, "Unable to delete VOD cache entry: ${entry.name}")
        }
    }

    /** Explicit recovery for a corrupt VOD response (e.g. HTTP 409). */
    fun clearAppCache(context: Context) {
        clearDirectory(internalVodCache(context))
        clearDirectory(externalVodCache(context))
    }

    /**
     * RAM pressure affects disposable image bitmaps, not disk data.
     * Glide's memory trim is managed by Glide lifecycle; never create a WebView
     * just to clear it, and never clear the shared Glide disk cache on trim.
     */
    fun trimMemory(context: Context, level: Int) {
        try {
            Glide.get(context.applicationContext).trimMemory(level)
        } catch (error: Exception) {
            Log.w(TAG, "Image cache trim failed", error)
        }
    }

    /** Run bounded VOD-disk maintenance only after native VOD has been unmounted. */
    fun pruneInBackground(context: Context, thresholdMb: Long = 50) {
        if (!pruning.compareAndSet(false, true)) return
        val app = context.applicationContext
        thread(name = "charm-vod-cache-prune", isDaemon = true) {
            try {
                autoClearIfNeeded(app, thresholdMb)
            } catch (error: Exception) {
                Log.w(TAG, "VOD cache pruning failed", error)
            } finally {
                pruning.set(false)
            }
        }
    }

    fun autoClearIfNeeded(context: Context, thresholdMb: Long = 50) {
        val threshold = thresholdMb.coerceAtLeast(1L) * 1024L * 1024L
        if (getCacheSize(context) > threshold) clearAppCache(context)
    }
}
