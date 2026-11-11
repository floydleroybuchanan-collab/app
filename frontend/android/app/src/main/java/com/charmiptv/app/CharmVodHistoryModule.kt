package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.streamflixreborn.streamflix.charm.VodRecentForHost
import java.util.concurrent.Executors

/**
 * Lets the Live TV screen list recently watched VOD titles.
 * One small daemon worker thread; never blocks the UI thread. Any failure
 * (no VOD provider chosen yet, database busy) resolves to an empty list so
 * the Live TV screen simply hides the row.
 */
class CharmVodHistoryModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "CharmVodHistory"

  @ReactMethod
  fun recent(limit: Double, promise: Promise) {
    val max = limit.toInt().coerceIn(1, 20)
    worker.execute {
      val rows = Arguments.createArray()
      runCatching { VodRecentForHost.read(reactApplicationContext, max) }
        .onSuccess { list ->
          for (entry in list) {
            rows.pushMap(Arguments.createMap().apply {
              putString("id", entry.id)
              putString("kind", entry.kind)
              putString("title", entry.title)
              if (entry.image.isNullOrBlank()) putNull("image") else putString("image", entry.image)
              putDouble("playedAt", entry.playedAt.toDouble())
              putInt("progress", entry.progress)
            })
          }
        }
      promise.resolve(rows)
    }
  }

  private companion object {
    val worker = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "CharmVodHistory").apply { isDaemon = true }
    }
  }
}
