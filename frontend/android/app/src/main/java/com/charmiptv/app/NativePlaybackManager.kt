package com.charmiptv.app

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import java.util.Locale
import java.util.concurrent.TimeUnit

@OptIn(UnstableApi::class)
object NativePlaybackManager {
  enum class Owner { NONE, PREVIEW, FULLSCREEN }

  data class AudioTrackInfo(val groupIndex: Int, val trackIndex: Int, val id: String, val label: String, val language: String?, val mimeType: String?, val supported: Boolean)
  data class SubtitleTrackInfo(val groupIndex: Int, val trackIndex: Int, val id: String, val label: String, val language: String?)
  data class SourceRefreshRequest(val requestId: Long, val owner: Owner, val channelKey: String, val recoveryAttempt: Int, val reason: String, val authenticationFailure: Boolean)
  data class PlaybackDiagnostic(
    val event: String,
    val media3ErrorCode: Int?,
    val media3ErrorCodeName: String?,
    val httpResponseCode: Int?,
    val exceptionType: String?,
    val errorSummary: String?,
    val causeChain: List<String>,
    val playbackState: String,
    val bufferedDurationMs: Long,
    val bufferedPositionMs: Long,
    val positionMs: Long,
    val channelKey: String?,
    val contentType: String?,
    val sourceType: String?,
    val detectedContainer: String?,
    val detectedMimeType: String?,
    val resolvedUri: String?,
    val probeHttpResponseCode: Int?,
    val probeReason: String?,
    val videoMimeType: String?,
    val videoCodecs: String?,
    val audioMimeType: String?,
    val audioCodecs: String?,
    val videoWidth: Int?,
    val videoHeight: Int?,
    val videoDecoder: String?,
    val audioDecoder: String?,
    val codecError: String?,
    val recoveryAttempt: Int,
    val lowRam: Boolean,
    val heapUsedBytes: Long,
    val heapMaxBytes: Long,
    val epgRamStats: Map<String, Long>,
  )
  interface Listener {
    fun onState(state: String, reason: String? = null)
    fun onTracks(audio: List<AudioTrackInfo>, subtitles: List<SubtitleTrackInfo>)
    fun onSourceRefreshRequested(request: SourceRefreshRequest)
    fun onDiagnostic(diagnostic: PlaybackDiagnostic)
  }
  private data class PlaybackSource(val channelKey: String, val uri: String, val headers: Map<String, String>, val contentType: String?, val sourceType: String)

  private const val MIN_BUFFER_MS_LOW_RAM = 10_000
  private const val MAX_BUFFER_MS_LOW_RAM = 30_000
  private const val PLAYBACK_BUFFER_MS_LOW_RAM = 2_500
  private const val REBUFFER_BUFFER_MS_LOW_RAM = 5_000
  private const val TARGET_BUFFER_BYTES_LOW_RAM = 16 * 1024 * 1024
  private const val MIN_BUFFER_MS_NORMAL = 15_000
  private const val MAX_BUFFER_MS_NORMAL = 60_000
  private const val PLAYBACK_BUFFER_MS_NORMAL = 3_000
  private const val REBUFFER_BUFFER_MS_NORMAL = 5_000
  private const val TARGET_BUFFER_BYTES_NORMAL = 48 * 1024 * 1024
  private const val HUNG_BUFFER_REPREPARE_MS = 5_000L
  private const val TRANSPORT_HUNG_BUFFER_REPREPARE_MS = 20_000L
  private const val STABLE_REARM_MS = 30_000L
  private const val MAX_AUTO_RECOVERIES = 4
  private val RECOVERY_BACKOFF_MS = longArrayOf(0L, 1_000L, 3_000L, 6_000L)
  private const val FULLSCREEN_START_TIMEOUT_MS = 12_000L
  private const val PREVIEW_START_TIMEOUT_MS = 8_000L
  private const val SOURCE_REFRESH_TIMEOUT_MS = 20_000L
  private const val OPAQUE_PROBE_CACHE_SIZE = 256
  private const val OPAQUE_TYPE_PREFS = "charm_media3_stream_types"
  private val OPAQUE_LIVE_CANDIDATES = listOf("transport", "hls", "dash", "progressive")
  private const val TAG = "CharmMedia3"

  private val httpClient = OkHttpClient.Builder()
    .connectionPool(ConnectionPool(6, 5, TimeUnit.MINUTES))
    .connectTimeout(8, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .writeTimeout(15, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()
  private val detectedTypeCache = object : LinkedHashMap<String, String>(64, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?): Boolean = size > OPAQUE_PROBE_CACHE_SIZE
  }
  private val main = Handler(Looper.getMainLooper())
  private var activity: Activity? = null
  private var previewSurface: FrameLayout? = null
  private var fullscreenSurface: FrameLayout? = null
  private var playerView: PlayerView? = null
  private var player: ExoPlayer? = null
  private var listener: Listener? = null
  private var owner: Owner = Owner.NONE
  private var activeSource: PlaybackSource? = null
  private var pendingSourceRefresh: SourceRefreshRequest? = null
  private var nextSourceRefreshRequestId = 1L
  private var lastPlaybackError: PlaybackException? = null
  private var firstFrameRendered = false
  private var recoveryAttempts = 0
  private var stableSinceMs = 0L
  private var bufferingSinceMs = 0L
  private var bufferingLastBufferedPositionMs = 0L
  private var bufferingLastPositionMs = 0L
  private var opaqueRouteSource: PlaybackSource? = null
  private var opaqueRouteCandidates: List<String> = emptyList()
  private var opaqueRouteIndex = -1
  private var opaqueRouteCacheKey: String? = null
  private var opaqueRouteWasCached = false

  // Per-channel diagnostics. These are reset on a new tune and updated by
  // Media3 renderer callbacks; diagnostics never create a second stream request.
  private var detectedMimeType: String? = null
  private var resolvedUri: String? = null
  private var probeHttpResponseCode: Int? = null
  private var probeReason: String? = null
  private var videoMimeType: String? = null
  private var videoCodecs: String? = null
  private var audioMimeType: String? = null
  private var audioCodecs: String? = null
  private var videoWidth: Int? = null
  private var videoHeight: Int? = null
  private var videoDecoder: String? = null
  private var audioDecoder: String? = null
  private var codecError: String? = null

  private val startupTimeout = Runnable {
    val instance = player ?: return@Runnable
    if (owner == Owner.NONE || firstFrameRendered) return@Runnable
    recordDiagnostic("start-timeout", lastPlaybackError, instance)
    recoverOnce(instance, skipBarePrepare = activeSource?.sourceType == "transport")
  }
  private val bufferingWatchdog: Runnable = Runnable {
    val instance = player ?: return@Runnable
    if (!firstFrameRendered || instance.playbackState != Player.STATE_BUFFERING) return@Runnable

    val nowMs = System.currentTimeMillis()
    val bufferedPosition = instance.bufferedPosition
    val position = instance.currentPosition
    val madeProgress = bufferedPosition > bufferingLastBufferedPositionMs || position > bufferingLastPositionMs
    bufferingLastBufferedPositionMs = bufferedPosition
    bufferingLastPositionMs = position

    if (madeProgress) {
      bufferingSinceMs = nowMs
      recordDiagnostic("buffer-progress", lastPlaybackError, instance)
      main.postDelayed(bufferingWatchdog, HUNG_BUFFER_REPREPARE_MS)
      return@Runnable
    }

    if (bufferingSinceMs == 0L) bufferingSinceMs = nowMs
    val hungForMs = nowMs - bufferingSinceMs
    val transport = activeSource?.sourceType == "transport"
    val recoveryThresholdMs = if (transport) TRANSPORT_HUNG_BUFFER_REPREPARE_MS else HUNG_BUFFER_REPREPARE_MS
    if (hungForMs < recoveryThresholdMs) {
      main.postDelayed(bufferingWatchdog, minOf(HUNG_BUFFER_REPREPARE_MS, recoveryThresholdMs - hungForMs))
      return@Runnable
    }

    recordDiagnostic("buffer-watchdog", lastPlaybackError, instance)
    // A continuous MPEG-TS socket needs a fresh HTTP request when it is truly
    // stalled. Bare prepare() is not useful enough here and was the source of
    // repeated native-reprepare loops on live TS channels.
    recoverOnce(instance, skipBarePrepare = transport)
  }
  private val delayedRecovery = Runnable {
    val instance = player ?: return@Runnable
    if (owner != Owner.NONE) performRecovery(instance)
  }
  private val sourceRefreshTimeout = Runnable {
    if (pendingSourceRefresh == null) return@Runnable
    pendingSourceRefresh = null
    val instance = player ?: return@Runnable
    recordDiagnostic("source-refresh-timeout", lastPlaybackError, instance)
    recoverOnce(instance, skipBarePrepare = activeSource?.sourceType == "transport")
  }
  private val opaqueTypeConfirmation = Runnable {
    val instance = player ?: return@Runnable
    if (owner == Owner.NONE || !firstFrameRendered || opaqueRouteCacheKey == null) return@Runnable
    if (instance.playbackState != Player.STATE_READY) return@Runnable
    confirmSuccessfulStreamType()
    recordDiagnostic("opaque-type-stable", lastPlaybackError, instance)
  }

  fun setListener(next: Listener?) = runOnMain { listener = next }
  fun installIntoActivity(activity: Activity) = runOnMain { this.activity = activity }
  fun attachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    when (surfaceOwner) { Owner.PREVIEW -> previewSurface = surface; Owner.FULLSCREEN -> fullscreenSurface = surface; Owner.NONE -> return@runOnMain }
    if (owner == surfaceOwner) attachPlayerView(surfaceOwner)
  }
  fun detachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    val attached = when (surfaceOwner) { Owner.PREVIEW -> previewSurface; Owner.FULLSCREEN -> fullscreenSurface; Owner.NONE -> null }
    if (attached !== surface) return@runOnMain
    playerView?.let { if (it.parent === surface) surface.removeView(it) }
    when (surfaceOwner) { Owner.PREVIEW -> previewSurface = null; Owner.FULLSCREEN -> fullscreenSurface = null; Owner.NONE -> Unit }
  }
  fun setResizeMode(mode: String?) = runOnMain {
    playerView?.resizeMode = when (mode) { "zoom", "fill" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM; "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL; else -> AspectRatioFrameLayout.RESIZE_MODE_FIT }
  }

  fun prepare(requestedOwner: Owner, channelKey: String, uri: String, headers: Map<String, String>, contentType: String?) = runOnMain {
    if (requestedOwner == Owner.PREVIEW && owner == Owner.FULLSCREEN) return@runOnMain
    val instance = ensurePlayer()
    cancelRecoveryCallbacks()
    owner = requestedOwner
    resetMediaDiagnostics()
    resetOpaqueRoutingState()
    val baseSource = PlaybackSource(channelKey.trim(), uri, LinkedHashMap(headers), contentType?.trim()?.takeIf { it.isNotEmpty() }, sourceTypeFor(uri, contentType))
    activeSource = baseSource
    seedKnownContainerMime(baseSource)
    lastPlaybackError = null
    firstFrameRendered = false
    recoveryAttempts = 0
    stableSinceMs = 0L
    resetBufferingWatchdogState()
    markPlaybackStarting("channel-start")
    if (!attachPlayerView(requestedOwner)) { finishWithError("surface-unavailable", instance); return@runOnMain }
    playerView?.visibility = View.VISIBLE
    publishState("loading", null)
    startOrRouteMediaSource(instance, baseSource, "channel-start")
  }

  fun provideFreshSource(requestId: Long, uri: String?, headers: Map<String, String>, contentType: String?, failureReason: String?) = runOnMain {
    val pending = pendingSourceRefresh ?: return@runOnMain
    if (pending.requestId != requestId) return@runOnMain
    pendingSourceRefresh = null
    main.removeCallbacks(sourceRefreshTimeout)
    val instance = player ?: return@runOnMain
    val source = activeSource
    if (source == null || source.channelKey != pending.channelKey || uri.isNullOrBlank()) {
      recordDiagnostic("source-refresh-failed:${failureReason ?: "unavailable"}", lastPlaybackError, instance)
      recoverOnce(instance, skipBarePrepare = activeSource?.sourceType == "transport")
      return@runOnMain
    }
    val freshContentType = contentType?.trim()?.takeIf { it.isNotEmpty() } ?: source.contentType
    val baseSource = PlaybackSource(source.channelKey, uri, LinkedHashMap(headers), freshContentType, sourceTypeFor(uri, freshContentType))
    resetOpaqueRoutingState()
    activeSource = baseSource
    seedKnownContainerMime(baseSource)
    markPlaybackStarting("fresh-source")
    recordDiagnostic("fresh-source-received", lastPlaybackError, instance)
    try {
      startOrRouteMediaSource(instance, baseSource, "fresh-source")
    } catch (error: Throwable) {
      recordDiagnostic("fresh-source-rebuild-failed:${error.javaClass.simpleName}", lastPlaybackError, instance)
      if (recoveryAttempts < MAX_AUTO_RECOVERIES) recoverOnce(instance, skipBarePrepare = activeSource?.sourceType == "transport") else finishWithError("stream-error", instance)
    }
  }

  fun pause() = runOnMain { player?.pause() }
  fun resume() = runOnMain { if (owner != Owner.NONE) player?.play() }
  fun setMuted(muted: Boolean) = runOnMain { player?.volume = if (muted) 0f else 1f }
  fun selectAudio(groupIndex: Int?, trackIndex: Int?, preferredLanguage: String?) = runOnMain {
    val instance = player ?: return@runOnMain
    val builder = instance.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO)
    if (groupIndex != null && trackIndex != null) {
      val group = instance.currentTracks.groups.getOrNull(groupIndex)?.mediaTrackGroup ?: return@runOnMain
      builder.addOverride(TrackSelectionOverride(group, trackIndex))
    } else builder.setPreferredAudioLanguage(preferredLanguage)
    instance.trackSelectionParameters = builder.build()
  }
  fun selectSubtitle(groupIndex: Int?, trackIndex: Int?, preferredLanguage: String?) = runOnMain {
    val instance = player ?: return@runOnMain
    val builder = instance.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT)
    if (groupIndex != null && trackIndex != null) {
      val group = instance.currentTracks.groups.getOrNull(groupIndex)?.mediaTrackGroup ?: return@runOnMain
      builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).addOverride(TrackSelectionOverride(group, trackIndex))
    } else if (preferredLanguage.isNullOrBlank()) builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
    else builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setPreferredTextLanguage(preferredLanguage)
    instance.trackSelectionParameters = builder.build()
  }
  fun stop(requestedOwner: Owner, releasePlayer: Boolean = false, onStopped: (() -> Unit)? = null) = runOnMain {
    if (owner != requestedOwner) { onStopped?.invoke(); return@runOnMain }
    stopInternal(releasePlayer); onStopped?.invoke()
  }
  fun suspendForBackground() = runOnMain { stopInternal(releasePlayer = true) }
  fun releaseAll() = runOnMain {
    stopInternal(releasePlayer = true)
    playerView?.let { video -> video.player = null; (video.parent as? ViewGroup)?.removeView(video) }
    listener = null; activity = null; previewSurface = null; fullscreenSurface = null; playerView = null
  }
  fun currentOwner(): Owner = owner

  private fun publishState(state: String, reason: String? = null) { listener?.onState(state, reason) }
  private fun stopInternal(releasePlayer: Boolean) {
    cancelRecoveryCallbacks()
    val instance = player
    try { instance?.stop() } catch (_: Throwable) {}
    try { instance?.clearMediaItems() } catch (_: Throwable) {}
    owner = Owner.NONE; activeSource = null; lastPlaybackError = null; firstFrameRendered = false; recoveryAttempts = 0; stableSinceMs = 0L
    resetBufferingWatchdogState()
    resetMediaDiagnostics()
    resetOpaqueRoutingState()
    CharmMemoryCoordinator.setPlaybackStarting(false)
    playerView?.visibility = View.GONE
    if (releasePlayer) {
      try { playerView?.player = null } catch (_: Throwable) {}
      try { (playerView?.parent as? ViewGroup)?.removeView(playerView) } catch (_: Throwable) {}
      try { instance?.release() } catch (_: Throwable) {}
      player = null
    }
  }

  private fun ensurePlayer(): ExoPlayer {
    player?.let { return it }
    val context = activity ?: throw IllegalStateException("Playback surface is not attached")
    val lowRam = CharmMemoryCoordinator.budgets().lowRam
    val loadControl = DefaultLoadControl.Builder().setBufferDurationsMs(
      if (lowRam) MIN_BUFFER_MS_LOW_RAM else MIN_BUFFER_MS_NORMAL,
      if (lowRam) MAX_BUFFER_MS_LOW_RAM else MAX_BUFFER_MS_NORMAL,
      if (lowRam) PLAYBACK_BUFFER_MS_LOW_RAM else PLAYBACK_BUFFER_MS_NORMAL,
      if (lowRam) REBUFFER_BUFFER_MS_LOW_RAM else REBUFFER_BUFFER_MS_NORMAL,
    ).setTargetBufferBytes(if (lowRam) TARGET_BUFFER_BYTES_LOW_RAM else TARGET_BUFFER_BYTES_NORMAL).setPrioritizeTimeOverSizeThresholds(true).build()
    // Use Media3's platform-appropriate codec adapter choice. Decoder fallback
    // remains enabled so a broken vendor decoder can fall through to another
    // supported MediaCodec implementation.
    val renderers = DefaultRenderersFactory(context)
      .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
      .setEnableDecoderFallback(true)
    val video = playerView ?: PlayerView(context).apply {
      useController = false
      setShutterBackgroundColor(Color.BLACK)
      setKeepContentOnPlayerReset(false)
      resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
      visibility = View.GONE
    }.also { playerView = it }
    return ExoPlayer.Builder(context, renderers)
      .setLoadControl(loadControl)
      .setMediaSourceFactory(DefaultMediaSourceFactory(createDataSourceFactory(emptyMap())))
      .build().also { created ->
        player = created; video.player = created
        created.addListener(object : Player.Listener {
          override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
              Player.STATE_BUFFERING -> {
                if (firstFrameRendered) {
                  rearmRecoveryAfterStablePlayback()
                  bufferingSinceMs = System.currentTimeMillis()
                  bufferingLastBufferedPositionMs = created.bufferedPosition
                  bufferingLastPositionMs = created.currentPosition
                  main.removeCallbacks(bufferingWatchdog)
                  main.postDelayed(bufferingWatchdog, HUNG_BUFFER_REPREPARE_MS)
                }
                publishState("loading", null)
              }
              Player.STATE_READY -> {
                main.removeCallbacks(bufferingWatchdog)
                resetBufferingWatchdogState()
                if (firstFrameRendered && stableSinceMs == 0L) stableSinceMs = System.currentTimeMillis()
                publishTracks(created.currentTracks)
              }
              Player.STATE_ENDED -> {
                recordDiagnostic("stream-ended", lastPlaybackError, created)
                rearmRecoveryAfterStablePlayback()
                recoverOnce(created, skipBarePrepare = true)
              }
              else -> Unit
            }
          }
          override fun onRenderedFirstFrame() {
            firstFrameRendered = true
            stableSinceMs = System.currentTimeMillis()
            main.removeCallbacks(startupTimeout)
            main.removeCallbacks(bufferingWatchdog)
            main.removeCallbacks(delayedRecovery)
            // Do not treat one decoded frame as proof that an opaque container
            // guess is correct. Some wrong guesses can render briefly and fail a
            // few seconds later. Keep candidate routing alive until the same
            // existing stable-playback window has elapsed.
            main.removeCallbacks(opaqueTypeConfirmation)
            if (opaqueRouteCacheKey != null) main.postDelayed(opaqueTypeConfirmation, STABLE_REARM_MS)
            resetBufferingWatchdogState()
            CharmMemoryCoordinator.setPlaybackStarting(false)
            recordDiagnostic("first-frame", lastPlaybackError, created)
            publishState("playing", null)
          }
          override fun onPlayerError(error: PlaybackException) {
            lastPlaybackError = error
            main.removeCallbacks(startupTimeout)
            main.removeCallbacks(bufferingWatchdog)
            main.removeCallbacks(opaqueTypeConfirmation)
            resetBufferingWatchdogState()
            recordDiagnostic("player-error", error, created)
            if (tryNextOpaqueCandidate(created, error)) return
            rearmRecoveryAfterStablePlayback()
            recoverOnce(
              created,
              forceFreshSource = isAuthenticationFailure(error),
              skipBarePrepare = activeSource?.sourceType == "transport",
            )
          }
          override fun onTracksChanged(tracks: Tracks) = publishTracks(tracks)
        })
        created.addAnalyticsListener(object : AnalyticsListener {
          override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
            videoMimeType = format.sampleMimeType
            videoCodecs = format.codecs
            if (format.width > 0) videoWidth = format.width
            if (format.height > 0) videoHeight = format.height
            recordDiagnostic("video-format", lastPlaybackError, created)
          }

          override fun onAudioInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
            audioMimeType = format.sampleMimeType
            audioCodecs = format.codecs
            recordDiagnostic("audio-format", lastPlaybackError, created)
          }

          override fun onVideoSizeChanged(eventTime: AnalyticsListener.EventTime, videoSize: VideoSize) {
            if (videoSize.width > 0) videoWidth = videoSize.width
            if (videoSize.height > 0) videoHeight = videoSize.height
            recordDiagnostic("video-size", lastPlaybackError, created)
          }

          override fun onVideoDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
            videoDecoder = decoderName
            recordDiagnostic("video-decoder-initialized", lastPlaybackError, created)
          }

          override fun onAudioDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
            audioDecoder = decoderName
            recordDiagnostic("audio-decoder-initialized", lastPlaybackError, created)
          }

          override fun onVideoCodecError(eventTime: AnalyticsListener.EventTime, videoCodecError: Exception) {
            codecError = "video:${safeThrowableSummary(videoCodecError)}"
            recordDiagnostic("video-codec-error", lastPlaybackError, created)
          }

          override fun onAudioCodecError(eventTime: AnalyticsListener.EventTime, audioCodecError: Exception) {
            codecError = "audio:${safeThrowableSummary(audioCodecError)}"
            recordDiagnostic("audio-codec-error", lastPlaybackError, created)
          }
        })
      }
  }

  private fun attachPlayerView(requestedOwner: Owner): Boolean {
    val target = when (requestedOwner) { Owner.PREVIEW -> previewSurface; Owner.FULLSCREEN -> fullscreenSurface; Owner.NONE -> null } ?: return false
    val video = playerView ?: return false
    if (video.parent !== target) { (video.parent as? ViewGroup)?.removeView(video); target.addView(video, fillParent()) } else video.layoutParams = fillParent()
    video.requestLayout(); return true
  }

  private fun recoverOnce(instance: ExoPlayer, forceFreshSource: Boolean = false, skipBarePrepare: Boolean = false): Boolean {
    if (owner == Owner.NONE || player !== instance) return false
    if (forceFreshSource && recoveryAttempts < 2) recoveryAttempts = 2
    else if (skipBarePrepare && recoveryAttempts < 1) recoveryAttempts = 1
    if (recoveryAttempts >= MAX_AUTO_RECOVERIES) { finishWithError("stream-error", instance); return false }
    val delayMs = RECOVERY_BACKOFF_MS[recoveryAttempts]
    recoveryAttempts += 1
    cancelRecoveryCallbacks()
    markPlaybackStarting("recovery-$recoveryAttempts")
    recordDiagnostic("recovery-$recoveryAttempts-scheduled", lastPlaybackError, instance)
    publishState("loading", "native-reprepare")
    if (delayMs == 0L) return performRecovery(instance)
    main.postDelayed(delayedRecovery, delayMs)
    return true
  }
  private fun performRecovery(instance: ExoPlayer): Boolean {
    if (owner == Owner.NONE || player !== instance) return false
    val source = activeSource
    return try {
      when (recoveryAttempts) {
        1 -> { instance.prepare(); instance.playWhenReady = true; armStartupTimeout() }
        2 -> { if (source == null) throw IllegalStateException("No active playback source"); rebuildMediaSource(instance, source, "media-source-rebuild") }
        3 -> requestFreshSource(instance, source)
        4 -> fullPlayerAndSourceRecovery(instance, source)
        else -> finishWithError("stream-error", instance)
      }
      true
    } catch (t: Throwable) {
      recordDiagnostic("recovery-$recoveryAttempts-failed:${t.javaClass.simpleName}", lastPlaybackError, instance)
      if (recoveryAttempts < MAX_AUTO_RECOVERIES) recoverOnce(instance, skipBarePrepare = activeSource?.sourceType == "transport") else {
        finishWithError("stream-error", instance)
        false
      }
    }
  }
  private fun requestFreshSource(instance: ExoPlayer, source: PlaybackSource?) {
    if (source == null || source.channelKey.isBlank()) {
      recordDiagnostic("source-refresh-unavailable", lastPlaybackError, instance)
      recoverOnce(instance, skipBarePrepare = activeSource?.sourceType == "transport")
      return
    }
    val request = SourceRefreshRequest(nextSourceRefreshRequestId++, owner, source.channelKey, recoveryAttempts, lastPlaybackError?.errorCodeName ?: "stream-stalled", isAuthenticationFailure(lastPlaybackError))
    pendingSourceRefresh = request
    recordDiagnostic("source-refresh-requested", lastPlaybackError, instance)
    listener?.onSourceRefreshRequested(request)
    main.postDelayed(sourceRefreshTimeout, SOURCE_REFRESH_TIMEOUT_MS)
  }
  private fun fullPlayerAndSourceRecovery(instance: ExoPlayer, source: PlaybackSource?) {
    if (source == null) throw IllegalStateException("No active playback source")
    if (CharmMemoryCoordinator.budgets().lowRam) {
      CharmMemoryCoordinator.trimNonEssentialForPlaybackRecovery()
      recordDiagnostic("low-ram-nonessential-trim", lastPlaybackError, instance)
    }
    try { playerView?.player = null } catch (_: Throwable) {}
    try { instance.release() } catch (_: Throwable) {}
    player = null
    firstFrameRendered = false
    resetBufferingWatchdogState()
    val rebuilt = ensurePlayer()
    if (!attachPlayerView(owner)) throw IllegalStateException("Playback surface is unavailable")
    rebuildMediaSource(rebuilt, source, "full-player-source-recovery")
  }

  private fun startOrRouteMediaSource(instance: ExoPlayer, source: PlaybackSource, event: String) {
    if (source.sourceType != "unknown" || !isHttpOrHttps(source.uri)) {
      resetOpaqueRoutingState()
      val routed = if (source.sourceType == "unknown") source.copy(sourceType = "progressive") else source
      activeSource = routed
      seedKnownContainerMime(routed)
      rebuildMediaSource(instance, routed, event)
      return
    }

    val cacheKey = detectedTypeCacheKey(source)
    readDetectedType(cacheKey)?.let { cachedType ->
      probeReason = "cache:$cachedType"
      recordDiagnostic("opaque-cache-hit", lastPlaybackError, instance)
      startOpaqueCandidate(instance, source, cacheKey, cachedType, "$event-opaque-cache-$cachedType", fromCache = true)
      return
    }

    // Do not open a separate GET just to sniff an opaque live URL. A number of
    // IPTV providers allow only one active connection per token/session, and the
    // old probe could consume or disturb the same stream Media3 then tried to play.
    // Start the existing single Media3 player directly on the live-first candidate
    // and let a real parser/container mismatch advance the bounded candidate list.
    probeReason = "direct:transport"
    resolvedUri = redactUriForDiagnostics(source.uri)
    recordDiagnostic("opaque-direct-start", lastPlaybackError, instance)
    startOpaqueCandidate(instance, source, cacheKey, "transport", "$event-opaque-transport", fromCache = false)
  }

  private fun startOpaqueCandidate(instance: ExoPlayer, source: PlaybackSource, cacheKey: String, firstType: String, event: String, fromCache: Boolean) {
    main.removeCallbacks(opaqueTypeConfirmation)
    opaqueRouteSource = source
    opaqueRouteCacheKey = cacheKey
    opaqueRouteWasCached = fromCache
    opaqueRouteCandidates = orderedOpaqueCandidates(firstType)
    opaqueRouteIndex = 0
    stableSinceMs = 0L
    val routed = source.copy(sourceType = opaqueRouteCandidates.first())
    activeSource = routed
    detectedMimeType = detectedMimeType ?: knownMimeForSource(routed)
    rebuildMediaSource(instance, routed, event)
  }

  private fun tryNextOpaqueCandidate(instance: ExoPlayer, error: PlaybackException): Boolean {
    if (!isContainerMismatch(error)) return false
    val original = opaqueRouteSource ?: return false
    if (opaqueRouteIndex < 0 || opaqueRouteCandidates.isEmpty()) return false
    main.removeCallbacks(opaqueTypeConfirmation)
    val cacheKey = opaqueRouteCacheKey
    if (opaqueRouteWasCached && cacheKey != null) {
      forgetDetectedType(cacheKey)
      opaqueRouteWasCached = false
      recordDiagnostic("opaque-cache-invalidated", error, instance)
    }
    val nextIndex = opaqueRouteIndex + 1
    if (nextIndex >= opaqueRouteCandidates.size) return false
    opaqueRouteIndex = nextIndex
    stableSinceMs = 0L
    val nextType = opaqueRouteCandidates[nextIndex]
    val routed = original.copy(sourceType = nextType)
    activeSource = routed
    detectedMimeType = knownMimeForSource(routed)
    probeReason = "${probeReason ?: "opaque"};parser-retry:$nextType"
    recordDiagnostic("opaque-type-retry-$nextType", error, instance)
    lastPlaybackError = null
    return try {
      rebuildMediaSource(instance, routed, "opaque-type-retry-$nextType")
      true
    } catch (failure: Throwable) {
      recordDiagnostic("opaque-type-retry-failed:${failure.javaClass.simpleName}", error, instance)
      false
    }
  }

  private fun rebuildMediaSource(instance: ExoPlayer, source: PlaybackSource, event: String) {
    markPlaybackStarting(event)
    val item = buildMediaItem(source)
    val mediaSource = buildMediaSource(item, source)
    firstFrameRendered = false
    main.removeCallbacks(bufferingWatchdog)
    resetBufferingWatchdogState()
    try { instance.stop() } catch (_: Throwable) {}
    try { instance.clearMediaItems() } catch (_: Throwable) {}
    instance.setMediaSource(mediaSource, true)
    instance.prepare()
    instance.playWhenReady = true
    armStartupTimeout()
    recordDiagnostic(event, lastPlaybackError, instance)
  }
  private fun buildMediaItem(source: PlaybackSource): MediaItem {
    val builder = MediaItem.Builder().setUri(Uri.parse(source.uri))
    when (source.sourceType) {
      "hls" -> builder.setMimeType(MimeTypes.APPLICATION_M3U8)
      "dash" -> builder.setMimeType(MimeTypes.APPLICATION_MPD)
      "transport" -> builder.setMimeType(MimeTypes.VIDEO_MP2T)
    }
    return builder.build()
  }
  private fun buildMediaSource(item: MediaItem, source: PlaybackSource): MediaSource {
    val dataSource = createDataSourceFactory(source.headers)
    return when (source.sourceType) {
      "hls" -> HlsMediaSource.Factory(dataSource).createMediaSource(item)
      "transport" -> ProgressiveMediaSource.Factory(dataSource, createLiveTsExtractorsFactory()).createMediaSource(item)
      else -> DefaultMediaSourceFactory(dataSource).createMediaSource(item)
    }
  }
  private fun createLiveTsExtractorsFactory(): DefaultExtractorsFactory =
    DefaultExtractorsFactory().setTsExtractorFlags(
      DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
        DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS,
    )

  private fun createDataSourceFactory(headers: Map<String, String>): DefaultDataSource.Factory {
    val context = activity ?: throw IllegalStateException("Playback surface is not attached")
    return DefaultDataSource.Factory(context, OkHttpDataSource.Factory(httpClient).setDefaultRequestProperties(headers))
  }
  private fun finishWithError(reason: String, instance: ExoPlayer? = player) {
    cancelRecoveryCallbacks()
    recordDiagnostic("definitive-$reason", lastPlaybackError, instance)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    publishState("error", reason)
  }
  private fun cancelRecoveryCallbacks() {
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(bufferingWatchdog)
    main.removeCallbacks(delayedRecovery)
    main.removeCallbacks(sourceRefreshTimeout)
    main.removeCallbacks(opaqueTypeConfirmation)
    pendingSourceRefresh = null
    resetBufferingWatchdogState()
  }
  private fun resetOpaqueRoutingState() {
    main.removeCallbacks(opaqueTypeConfirmation)
    opaqueRouteSource = null
    opaqueRouteCandidates = emptyList()
    opaqueRouteIndex = -1
    opaqueRouteCacheKey = null
    opaqueRouteWasCached = false
  }
  private fun resetBufferingWatchdogState() { bufferingSinceMs = 0L; bufferingLastBufferedPositionMs = 0L; bufferingLastPositionMs = 0L }
  private fun resetMediaDiagnostics() {
    detectedMimeType = null
    resolvedUri = null
    probeHttpResponseCode = null
    probeReason = null
    videoMimeType = null
    videoCodecs = null
    audioMimeType = null
    audioCodecs = null
    videoWidth = null
    videoHeight = null
    videoDecoder = null
    audioDecoder = null
    codecError = null
  }
  private fun markPlaybackStarting(reason: String) { CharmMemoryCoordinator.setPlaybackStarting(true); Log.d(TAG, "playback-starting: $reason") }
  private fun isAuthenticationFailure(error: PlaybackException?): Boolean = findHttpResponseCode(error) in setOf(401, 403)
  private fun isContainerMismatch(error: PlaybackException): Boolean {
    if (error.errorCodeName.contains("PARSING", ignoreCase = true)) return true
    return causeChain(error).any { name ->
      name.contains("ParserException", ignoreCase = true) ||
        name.contains("UnrecognizedInputFormatException", ignoreCase = true)
    }
  }
  private fun findHttpResponseCode(error: Throwable?): Int? {
    var current = error
    repeat(12) {
      if (current is HttpDataSource.InvalidResponseCodeException) return current.responseCode
      current = current?.cause
      if (current == null) return null
    }
    return null
  }
  private fun causeChain(error: Throwable?): List<String> {
    val types = ArrayList<String>(6)
    var current = error
    repeat(8) {
      val value = current ?: return@repeat
      types += value.javaClass.name
      current = value.cause
      if (current == null) return types
    }
    return types
  }
  private fun playbackStateName(instance: ExoPlayer?): String = when (instance?.playbackState) {
    Player.STATE_IDLE -> "idle"
    Player.STATE_BUFFERING -> "buffering"
    Player.STATE_READY -> "ready"
    Player.STATE_ENDED -> "ended"
    else -> "none"
  }
  private fun sourceTypeFor(uri: String, contentType: String?): String {
    val hint = contentType?.substringBefore(';')?.trim()?.lowercase(Locale.US).orEmpty()
    val lowerUri = uri.lowercase(Locale.US)
    val hlsUri = Regex("\\.m3u8(?:$|[?#])").containsMatchIn(lowerUri) || Regex("[?&](?:format|type|output)=(?:hls|m3u8)(?:&|$)").containsMatchIn(lowerUri) || lowerUri.contains("/hls/")
    val dashUri = Regex("\\.mpd(?:$|[?#])").containsMatchIn(lowerUri) || Regex("[?&](?:format|type|output)=(?:dash|mpd)(?:&|$)").containsMatchIn(lowerUri) || lowerUri.contains("/dash/")
    val transportUri = Regex("\\.(?:ts|m2ts)(?:$|[?#])").containsMatchIn(lowerUri) || lowerUri.contains("mpegts") || lowerUri.contains("mpeg-ts") || Regex("[?&](?:format|type|output)=(?:ts|mpegts|mpeg-ts)(?:&|$)").containsMatchIn(lowerUri)
    val progressiveUri = Regex("\\.(?:mp4|m4v|m4a|m4s|mov|webm|mkv|avi|flv|mpg|mpeg|vob|mp3|aac|ogg|wav|flac|amr|cmfv|cmfa)(?:$|[?#])").containsMatchIn(lowerUri)
    return when {
      hint == "hls" || hint == "m3u8" || hint == MimeTypes.APPLICATION_M3U8 || hint == "application/x-mpegurl" || hint == "application/vnd.apple.mpegurl" || hlsUri -> "hls"
      hint == "dash" || hint == "mpd" || hint == MimeTypes.APPLICATION_MPD || hint == "application/dash+xml" || dashUri -> "dash"
      hint == "transport" || hint == "ts" || hint == MimeTypes.VIDEO_MP2T || transportUri -> "transport"
      hint == "progressive" || progressiveUri -> "progressive"
      hint == "unknown" && isHttpOrHttps(uri) -> "unknown"
      hint.isEmpty() && isOpaqueHttpUri(uri) -> "unknown"
      else -> "progressive"
    }
  }
  private fun isHttpOrHttps(uri: String): Boolean {
    val scheme = try { Uri.parse(uri).scheme?.lowercase(Locale.US) } catch (_: Throwable) { null }
    return scheme == "http" || scheme == "https"
  }
  private fun isOpaqueHttpUri(uri: String): Boolean {
    if (!isHttpOrHttps(uri)) return false
    val lower = uri.lowercase(Locale.US)
    if (lower.contains("format=") || lower.contains("type=") || lower.contains("output=") || lower.contains("/hls/") || lower.contains("/dash/")) return false
    return !Regex("\\.[a-z0-9]{2,5}(?:$|[?#])").containsMatchIn(lower)
  }
  private fun detectedTypeCacheKey(source: PlaybackSource): String =
    source.channelKey.takeIf { it.isNotBlank() }?.let { "channel:$it" } ?: "url:${source.uri.substringBefore('?').substringBefore('#')}"
  private fun orderedOpaqueCandidates(firstType: String): List<String> =
    (listOf(firstType) + OPAQUE_LIVE_CANDIDATES).filter(::isPersistableDetectedType).distinct()
  private fun isPersistableDetectedType(type: String): Boolean = type in setOf("hls", "dash", "transport", "progressive")
  private fun readDetectedType(cacheKey: String): String? {
    detectedTypeCache[cacheKey]?.let { return it }
    val persisted = try {
      activity?.getSharedPreferences(OPAQUE_TYPE_PREFS, Context.MODE_PRIVATE)?.getString(cacheKey, null)
    } catch (_: Throwable) {
      null
    }
    if (persisted != null && isPersistableDetectedType(persisted)) {
      detectedTypeCache[cacheKey] = persisted
      return persisted
    }
    return null
  }
  private fun rememberDetectedType(cacheKey: String, type: String) {
    if (!isPersistableDetectedType(type)) return
    detectedTypeCache[cacheKey] = type
    try {
      val prefs = activity?.getSharedPreferences(OPAQUE_TYPE_PREFS, Context.MODE_PRIVATE) ?: return
      val editor = prefs.edit().putString(cacheKey, type)
      if (!prefs.contains(cacheKey) && prefs.all.size >= OPAQUE_PROBE_CACHE_SIZE) {
        prefs.all.keys.firstOrNull { it != cacheKey }?.let(editor::remove)
      }
      editor.apply()
    } catch (_: Throwable) {}
  }
  private fun forgetDetectedType(cacheKey: String) {
    detectedTypeCache.remove(cacheKey)
    try { activity?.getSharedPreferences(OPAQUE_TYPE_PREFS, Context.MODE_PRIVATE)?.edit()?.remove(cacheKey)?.apply() } catch (_: Throwable) {}
  }
  private fun confirmSuccessfulStreamType() {
    val source = activeSource ?: return
    if (!isPersistableDetectedType(source.sourceType)) return
    val cacheKey = detectedTypeCacheKey(source)
    rememberDetectedType(cacheKey, source.sourceType)
    if (opaqueRouteCacheKey != null) probeReason = "${probeReason ?: "opaque"};confirmed:${source.sourceType}"
    resetOpaqueRoutingState()
  }
  private fun seedKnownContainerMime(source: PlaybackSource) {
    if (detectedMimeType != null) return
    detectedMimeType = knownMimeForSource(source)
  }
  private fun knownMimeForSource(source: PlaybackSource): String? = when (source.sourceType) {
    "hls" -> MimeTypes.APPLICATION_M3U8
    "dash" -> MimeTypes.APPLICATION_MPD
    "transport" -> MimeTypes.VIDEO_MP2T
    "progressive" -> progressiveContainerMime(source.uri)
    else -> null
  }
  private fun progressiveContainerMime(uri: String): String? {
    val lower = uri.substringBefore('?').substringBefore('#').lowercase(Locale.US)
    return when {
      lower.endsWith(".mp4") || lower.endsWith(".m4v") || lower.endsWith(".m4a") || lower.endsWith(".m4s") || lower.endsWith(".mov") || lower.endsWith(".cmfv") || lower.endsWith(".cmfa") -> "video/mp4"
      lower.endsWith(".webm") -> "video/webm"
      lower.endsWith(".mkv") -> "video/x-matroska"
      lower.endsWith(".flv") -> "video/x-flv"
      lower.endsWith(".aac") -> "audio/aac"
      lower.endsWith(".mp3") -> "audio/mpeg"
      lower.endsWith(".ogg") -> "application/ogg"
      lower.endsWith(".flac") -> "audio/flac"
      lower.endsWith(".wav") -> "audio/wav"
      else -> null
    }
  }
  private fun redactUriForDiagnostics(raw: String): String {
    return try {
      val parsed = Uri.parse(raw)
      val scheme = parsed.scheme ?: return "<opaque>"
      val host = parsed.host ?: return "$scheme://<opaque>"
      val last = parsed.lastPathSegment?.take(48)?.takeIf { it.isNotBlank() }
      if (last == null) "$scheme://$host/…" else "$scheme://$host/…/$last"
    } catch (_: Throwable) {
      "<opaque>"
    }
  }
  private fun safeThrowableSummary(error: Throwable?): String? {
    val value = error ?: return null
    val raw = value.message.orEmpty().replace(Regex("https?://\\S+", RegexOption.IGNORE_CASE), "<url>").replace('\n', ' ').replace('\r', ' ').trim().take(240)
    return if (raw.isEmpty()) value.javaClass.simpleName else "${value.javaClass.simpleName}:$raw"
  }
  private fun recordDiagnostic(event: String, error: PlaybackException?, instance: ExoPlayer?) {
    val runtime = Runtime.getRuntime()
    val bufferedPosition = instance?.bufferedPosition ?: 0L
    val position = instance?.currentPosition ?: 0L
    val source = activeSource
    val diagnostic = PlaybackDiagnostic(
      event = event,
      media3ErrorCode = error?.errorCode,
      media3ErrorCodeName = error?.errorCodeName,
      httpResponseCode = findHttpResponseCode(error),
      exceptionType = error?.cause?.javaClass?.name,
      errorSummary = safeThrowableSummary(error),
      causeChain = causeChain(error),
      playbackState = playbackStateName(instance),
      bufferedDurationMs = (bufferedPosition - position).coerceAtLeast(0L),
      bufferedPositionMs = bufferedPosition,
      positionMs = position,
      channelKey = source?.channelKey,
      contentType = source?.contentType,
      sourceType = source?.sourceType,
      detectedContainer = source?.sourceType,
      detectedMimeType = detectedMimeType,
      resolvedUri = resolvedUri,
      probeHttpResponseCode = probeHttpResponseCode,
      probeReason = probeReason,
      videoMimeType = videoMimeType,
      videoCodecs = videoCodecs,
      audioMimeType = audioMimeType,
      audioCodecs = audioCodecs,
      videoWidth = videoWidth,
      videoHeight = videoHeight,
      videoDecoder = videoDecoder,
      audioDecoder = audioDecoder,
      codecError = codecError,
      recoveryAttempt = recoveryAttempts,
      lowRam = CharmMemoryCoordinator.budgets().lowRam,
      heapUsedBytes = runtime.totalMemory() - runtime.freeMemory(),
      heapMaxBytes = runtime.maxMemory(),
      epgRamStats = CharmEpgRamDiagnostics.stats(),
    )
    Log.w(
      TAG,
      "event=${diagnostic.event} channel=${diagnostic.channelKey} code=${diagnostic.media3ErrorCodeName} http=${diagnostic.httpResponseCode} probeHttp=${diagnostic.probeHttpResponseCode} state=${diagnostic.playbackState} buffered=${diagnostic.bufferedDurationMs}ms source=${diagnostic.detectedContainer} mime=${diagnostic.detectedMimeType} resolved=${diagnostic.resolvedUri} probe=${diagnostic.probeReason} video=${diagnostic.videoMimeType}/${diagnostic.videoCodecs}@${diagnostic.videoWidth}x${diagnostic.videoHeight} vdec=${diagnostic.videoDecoder} audio=${diagnostic.audioMimeType}/${diagnostic.audioCodecs} adec=${diagnostic.audioDecoder} codecError=${diagnostic.codecError} attempt=${diagnostic.recoveryAttempt} lowRam=${diagnostic.lowRam} heap=${diagnostic.heapUsedBytes}/${diagnostic.heapMaxBytes} causes=${diagnostic.causeChain.joinToString(" <- ")} error=${diagnostic.errorSummary}",
    )
    listener?.onDiagnostic(diagnostic)
  }
  private fun rearmRecoveryAfterStablePlayback() {
    if (stableSinceMs > 0L && System.currentTimeMillis() - stableSinceMs >= STABLE_REARM_MS) {
      recoveryAttempts = 0
      stableSinceMs = 0L
    }
  }
  private fun armStartupTimeout() {
    main.removeCallbacks(startupTimeout)
    if (owner != Owner.NONE) main.postDelayed(startupTimeout, if (owner == Owner.PREVIEW) PREVIEW_START_TIMEOUT_MS else FULLSCREEN_START_TIMEOUT_MS)
  }
  private fun publishTracks(tracks: Tracks) {
    val audio = ArrayList<AudioTrackInfo>()
    val subtitles = ArrayList<SubtitleTrackInfo>()
    tracks.groups.forEachIndexed { groupIndex, group ->
      for (trackIndex in 0 until group.length) {
        val format = group.getTrackFormat(trackIndex)
        val mime = format.sampleMimeType
        val id = format.id ?: "g${groupIndex}:t${trackIndex}:${mime ?: "unknown"}:${format.language ?: "und"}"
        if (group.type == C.TRACK_TYPE_AUDIO) audio += AudioTrackInfo(groupIndex, trackIndex, id, format.label ?: format.language ?: "Audio ${audio.size + 1}", format.language, mime, group.isTrackSupported(trackIndex))
        else if (group.type == C.TRACK_TYPE_TEXT) subtitles += SubtitleTrackInfo(groupIndex, trackIndex, id, format.label ?: format.language ?: "CC ${subtitles.size + 1}", format.language)
      }
    }
    listener?.onTracks(audio, subtitles)
  }
  private fun fillParent() = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
  private fun runOnMain(block: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block) }
}
