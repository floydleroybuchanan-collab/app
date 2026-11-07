package com.streamflixreborn.streamflix.utils

import android.content.Context
import android.util.Log
import android.webkit.WebView
import com.bumptech.glide.Glide
import java.io.File

object CacheUtils {
    private const val TAG = "CacheUtils"

    private val clearing = java.util.concurrent.atomic.AtomicBoolean(false)
    private val clearExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    fun clearAppCache(context: Context) {
        if (!clearing.compareAndSet(false, true)) return
        val app = context.applicationContext
        val provider = UserPreferences.currentProvider
        val isolated = com.streamflixreborn.streamflix.charm.CharmVodProcess.isVod
        clearExecutor.execute {
            try {
                provider?.let { HomeCacheStore.clear(app, it) }
                // Never delete cache directories behind live Glide/HTTP/Cronet
                // owners. In the shared host, image caches also serve live TV.
                if (isolated) Glide.get(app).clearDiskCache()
            } catch (_: Exception) {
                // Cache recovery must not interrupt the caller's retry action.
            } finally { clearing.set(false) }
        }
        if (isolated) main.post {
            runCatching { Glide.get(app).clearMemory() }
            runCatching { WebView(app).apply { clearCache(true); destroy() } }
        }
    }

    fun getCacheSize(context: Context): Long {
        var size: Long = 0
        try {
            size += getFolderSize(context.applicationContext.cacheDir)
            size += getFolderSize(context.applicationContext.externalCacheDir)
        } catch (_: Exception) {
        }
        return size
    }

    private fun getFolderSize(file: File?): Long {
        if (file == null || !file.exists()) return 0
        if (!file.isDirectory) return file.length()

        var size: Long = 0
        val files = file.listFiles()
        if (files != null) {
            for (f in files) {
                size += if (f.isDirectory) getFolderSize(f) else f.length()
            }
        }
        return size
    }

    fun autoClearIfNeeded(context: Context, thresholdMb: Long = 50) {
        val currentSize = getCacheSize(context)
        val thresholdBytes = thresholdMb * 1024 * 1024
        val currentMb = currentSize / (1024 * 1024)

        Log.d(TAG, "Controllo cache: Attuale = ${currentMb}MB, Soglia = ${thresholdMb}MB")

        if (currentSize > thresholdBytes) {
            Log.i(TAG, "Soglia superata! Avvio pulizia automatica...")
            clearAppCache(context)
        } else {
            Log.d(TAG, "Soglia non raggiunta. Nessuna pulizia necessaria.")
        }
    }
}
