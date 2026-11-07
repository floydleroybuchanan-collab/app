package com.streamflixreborn.streamflix.utils

import android.content.Context
import android.util.Log
import android.content.ComponentCallbacks2
import android.os.Handler
import android.os.Looper
import com.bumptech.glide.Glide
import java.io.File

object CacheUtils {
    private const val TAG = "CacheUtils"
    private val maintenance = java.util.concurrent.Executors.newSingleThreadExecutor { task -> Thread(task, "CharmVodCacheMaintenance").apply { isDaemon = true } }
    private val clearing = java.util.concurrent.atomic.AtomicBoolean(false)

    fun trimMemory(context: Context, level: Int) {
        if (level != ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN && level < ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) return
        HomeCacheStore.trimMemory()
        val app = context.applicationContext
        val trim = Runnable { runCatching { Glide.get(app).trimMemory(level) } }
        if (Looper.myLooper() == Looper.getMainLooper()) trim.run() else Handler(Looper.getMainLooper()).post(trim)
    }

    fun clearAppCache(context: Context) {
        HomeCacheStore.trimMemory()
        val app = context.applicationContext
        if (!clearing.compareAndSet(false, true)) return
        maintenance.execute {
            try { HomeCacheStore.clearDiskCache(app) }
            finally { clearing.set(false) }
        }
    }

    fun getCacheSize(context: Context): Long {
        var size: Long = 0
        try {
            // Match the scope of clearAppCache: only regenerable catalog JSON.
            size += File(context.filesDir, "home-cache").listFiles()?.filter { it.isFile && it.extension == "json" }?.sumOf { it.length() } ?: 0L
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
