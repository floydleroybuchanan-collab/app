package com.streamflixreborn.streamflix.vod

import com.streamflixreborn.streamflix.StreamFlixApp
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicLong

object VodPreferences {
    private val prefs get() = StreamFlixApp.instance.getSharedPreferences("charm-vod-playback", 0)
    // The detail-page Sources action is a ONE-shot navigation intent, not a
    // permanent Settings change. Only a player reaching server selection can
    // consume it, and stale requests expire rather than affecting later media.
    private val sourcePickerRequestedAt = AtomicLong(0L)
    fun requestSourcesForNextPlayback() {
        sourcePickerRequestedAt.set(SystemClock.elapsedRealtime())
    }
    var chooseFirst: Boolean
        get() {
            val requestedAt = sourcePickerRequestedAt.getAndSet(0L)
            val recent = requestedAt > 0L &&
                SystemClock.elapsedRealtime() - requestedAt in 0L..30000L
            return recent || prefs.getBoolean("choose-first", false)
        }
        set(value) { prefs.edit().putBoolean("choose-first", value).apply() }
    var debridSearch: Boolean
        get() = prefs.getBoolean("debrid-search", true)
        set(value) { prefs.edit().putBoolean("debrid-search", value).apply() }
    var engine: String
        get() = prefs.getString("engine", "media3") ?: "media3"
        set(value) { prefs.edit().putString("engine", value).apply() }
}
