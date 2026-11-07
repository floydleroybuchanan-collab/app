package com.streamflixreborn.streamflix.charm

import android.app.ActivityManager
import android.content.Context
import androidx.media3.common.C
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer

/** Shared engine policy. Routes retain their own sources, controls and saved progress. */
object CharmPlaybackCore {
    private var activePlayer: ExoPlayer? = null
    private var releaseActive: (() -> Unit)? = null

    /** Run on the player application looper. Stale releases cannot clear a newer owner. */
    fun claim(player: ExoPlayer, releaseOwner: () -> Unit) {
        check(android.os.Looper.myLooper() == android.os.Looper.getMainLooper())
        if (activePlayer !== player) {
            releaseActive?.invoke()
            check(activePlayer == null) { "Previous playback owner did not release its player" }
            activePlayer = player
        }
        releaseActive = releaseOwner
    }
    fun lowRam(context: Context): Boolean =
        (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.isLowRamDevice == true

    fun bufferBytes(lowRam: Boolean): Int = (if (lowRam) 16 else 48) * 1024 * 1024

    fun liveDurations(profile: String, lowRam: Boolean): IntArray {
        val values = when (profile) {
            "low_latency" -> intArrayOf(1_000, 5_000, 500, 1_000)
            "balanced" -> intArrayOf(3_000, 15_000, 1_000, 2_000)
            else -> intArrayOf(10_000, 30_000, 1_500, 3_000)
        }
        if (lowRam) values[1] = minOf(values[1], 15_000)
        return values
    }

    fun vodLoadControl(context: Context, profile: String, extraBuffering: Boolean): DefaultLoadControl {
        val lowRam = lowRam(context)
        val values = when (profile) {
            "low_latency" -> intArrayOf(5_000, 15_000, 750, 1_500)
            "balanced" -> intArrayOf(15_000, 30_000, 1_500, 3_000)
            else -> intArrayOf(30_000, 60_000, 2_500, 5_000)
        }
        // Extra buffering may wait for more data, but must not bypass the RAM budget.
        if (extraBuffering) values[1] = if (lowRam) 30_000 else 120_000
        if (lowRam) {
            values[0] = minOf(values[0], 15_000)
            values[1] = minOf(values[1], 30_000)
        }
        return DefaultLoadControl.Builder()
            .setBufferDurationsMs(values[0], values[1], values[2], values[3])
            .setTargetBufferBytes(bufferBytes(lowRam))
            .setPrioritizeTimeOverSizeThresholds(false)
            .build()
    }

    fun builder(context: Context, renderers: DefaultRenderersFactory): ExoPlayer.Builder {
        renderers.setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
        return ExoPlayer.Builder(context, renderers).setWakeMode(C.WAKE_MODE_NETWORK)
    }

    /** Let Media3 signal source cadence without forcing a disruptive display-mode change. */
    fun configure(player: ExoPlayer) {
        player.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS)
    }

    // Callers detach views/session first, and preserve their failure handling around this call.
    fun release(player: ExoPlayer?) {
        player?.release()
        if (activePlayer === player) { activePlayer = null; releaseActive = null }
    }
}
