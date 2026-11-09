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
    private val sessionActive = AtomicBoolean(false)

    fun setSessionActive(active: Boolean) { sessionActive.set(active) }

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

    private fun clearDirectory(root: File?, background: Boolean = false) {
        if (root == null || !root.isDirectory) return
        // Background cleanup stops if a new VOD session opens mid-prune.
        if (background && sessionActive.get()) return
        // Only clear children of the VOD-owned namespace. Never delete the
        // namespace itself, host cache root, guide, or app databases.
        root.listFiles()?.forEach { entry ->
            if (!background || !sessionActive.get()) {
                if (!entry.deleteRecursively()) Log.w(TAG, "Unable to delete VOD cache entry: ${entry.name}")
            }
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
        if (sessionActive.get() || !pruning.compareAndSet(false, true)) return
        val app = context.applicationContext
        thread(name = "charm-vod-cache-prune", isDaemon = true) {
            try {
                if (!sessionActive.get()) {
                    val threshold = thresholdMb.coerceAtLeast(1L) * 1024L * 1024L
                    if (getCacheSize(app) > threshold && !sessionActive.get()) {
                        clearDirectory(internalVodCache(app), background = true)
                        clearDirectory(externalVodCache(app), background = true)
                    }
                }
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
