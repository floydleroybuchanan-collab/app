package com.streamflixreborn.streamflix.charm

import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.ui.SubtitleView
import androidx.media3.ui.CaptionStyleCompat
import android.graphics.Color

/** Shared preferences travel explicitly into the isolated VOD process. */
object CharmSharedPlayback {
    var settings = JSONObject()
        private set
    fun configure(value: String?) { settings = runCatching { JSONObject(value ?: "{}") }.getOrDefault(JSONObject()) }
    fun apply(player: ExoPlayer) {
        if (!settings.has("audio")) return
        val subtitles = settings.optString("subtitle", "")
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguage(settings.optString("audio", "").ifBlank { null })
            .setPreferredTextLanguage(subtitles.ifBlank { null })
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, subtitles.isBlank()).build()
    }

    fun captions(view: SubtitleView?) {
        if (!settings.has("size")) return
        view?.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * when(settings.optString("size")) {
            "small" -> .8f; "large" -> 1.3f; else -> 1f
        })
        val background = when(settings.optString("background")) {
            "none" -> Color.TRANSPARENT; "solid" -> Color.BLACK; else -> 0x99000000.toInt()
        }
        view?.setStyle(CaptionStyleCompat(Color.WHITE, background, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null))
    }

    fun buffer(builder: DefaultLoadControl.Builder): DefaultLoadControl.Builder {
        if (!settings.has("buffer")) return builder
        val durations = when(settings.optString("buffer")) {
            "low_latency" -> intArrayOf(5000, 15000, 750, 1500)
            "balanced" -> intArrayOf(15000, 30000, 1500, 3000)
            else -> intArrayOf(30000, 60000, 2500, 5000)
        }
        return builder.setBufferDurationsMs(durations[0], durations[1], durations[2], durations[3])
            .setTargetBufferBytes(48 * 1024 * 1024)
    }
}
