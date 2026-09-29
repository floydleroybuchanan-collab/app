package com.streamflixreborn.streamflix.charm

import android.content.Context
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.RenderersFactory
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.source.MediaSource
import org.json.JSONObject

/** Host settings are authoritative for both Live TV and VOD. */
object MediaLabPlayback {
    var settings = JSONObject()
    fun configure(value: String) {
        settings = JSONObject(value)
        val prefs = com.streamflixreborn.streamflix.utils.UserPreferences
        prefs.captionTextSize = when (settings.optString("size")) { "small" -> .8f; "large" -> 1.3f; else -> 1f }
        val background = when (settings.optString("background")) { "none" -> android.graphics.Color.TRANSPARENT; "solid" -> android.graphics.Color.BLACK; else -> 0x99000000.toInt() }
        prefs.captionStyle = androidx.media3.ui.CaptionStyleCompat(android.graphics.Color.WHITE, background, android.graphics.Color.TRANSPARENT, androidx.media3.ui.CaptionStyleCompat.EDGE_TYPE_OUTLINE, android.graphics.Color.BLACK, null)
    }
    fun builder(context: Context, renderers: RenderersFactory, source: MediaSource.Factory, loadControl: LoadControl): ExoPlayer.Builder =
        ExoPlayer.Builder(context, renderers).setMediaSourceFactory(source).setLoadControl(loadControl).setWakeMode(C.WAKE_MODE_NETWORK)
    fun vodLoadControl(): LoadControl {
        val max = when (settings.optString("buffer", "stable")) { "low_latency" -> 15000; "balanced" -> 30000; else -> 50000 }
        return DefaultLoadControl.Builder().setBufferDurationsMs(minOf(15000, max), max, 1500, 3000)
            .setTargetBufferBytes(48 * 1024 * 1024).setPrioritizeTimeOverSizeThresholds(false).build()
    }
    fun apply(player: ExoPlayer) {
        val text = settings.optString("subtitle", "")
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguage(settings.optString("audio", "").ifBlank { null })
            .setPreferredTextLanguage(text.ifBlank { null })
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, text.isBlank()).build()
    }
}
