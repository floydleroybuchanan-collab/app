package com.charmiptv.app

import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.DecoderReuseEvaluation

/** Captures the actual decoder callbacks and selected A/V formats from Media3. */
@OptIn(UnstableApi::class)
class PlaybackCodecDiagnostics : AnalyticsListener {
  data class Snapshot(
    val videoMime: String? = null,
    val videoCodecs: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val videoDecoder: String? = null,
    val audioMime: String? = null,
    val audioCodecs: String? = null,
    val audioDecoder: String? = null,
  )

  @Volatile private var videoDecoder: String? = null
  @Volatile private var audioDecoder: String? = null
  @Volatile private var videoFormat: Format? = null
  @Volatile private var audioFormat: Format? = null

  override fun onVideoDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
    videoDecoder = decoderName
    log("video-decoder", snapshot())
  }

  override fun onAudioDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
    audioDecoder = decoderName
    log("audio-decoder", snapshot())
  }

  override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
    videoFormat = format
    log("video-format", snapshot())
  }

  override fun onAudioInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
    audioFormat = format
    log("audio-format", snapshot())
  }

  fun updateTracks(tracks: Tracks) {
    tracks.groups.forEach { group ->
      for (trackIndex in 0 until group.length) {
        if (!group.isTrackSelected(trackIndex)) continue
        val format = group.getTrackFormat(trackIndex)
        when (group.type) {
          C.TRACK_TYPE_VIDEO -> videoFormat = format
          C.TRACK_TYPE_AUDIO -> audioFormat = format
        }
      }
    }
  }

  fun reset() {
    videoDecoder = null; audioDecoder = null; videoFormat = null; audioFormat = null
  }

  fun snapshot(): Snapshot {
    val video = videoFormat
    val audio = audioFormat
    return Snapshot(
      videoMime = video?.sampleMimeType,
      videoCodecs = video?.codecs,
      width = video?.width?.takeIf { it > 0 },
      height = video?.height?.takeIf { it > 0 },
      videoDecoder = videoDecoder,
      audioMime = audio?.sampleMimeType,
      audioCodecs = audio?.codecs,
      audioDecoder = audioDecoder,
    )
  }

  private fun log(event: String, value: Snapshot) {
    Log.i("CharmMedia3Codec", "event=$event video=${value.videoMime}/${value.videoCodecs} ${value.width}x${value.height} videoDecoder=${value.videoDecoder} audio=${value.audioMime}/${value.audioCodecs} audioDecoder=${value.audioDecoder}")
  }
}
