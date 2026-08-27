package com.charmiptv.app

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.LayoutInflater
import android.view.TextureView
import android.view.View
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
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
import androidx.media3.exoplayer.dash.DashMediaSource
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.rtsp.RtspMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.util.Locale

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

  // Small/Medium/Large keep the public player setting while the maximum native
  // allocation remains capped at the Onn/Fire-TV-safe 48 MB budget.
  private const val TARGET_BUFFER_BYTES_LOW_RAM = 16 * 1024 * 1024
  private const val TARGET_BUFFER_BYTES_NORMAL = 48 * 1024 * 1024
  // Match the builder's TiViMate-style panel UA. OkHttp's default "okhttp/x.x"
  // (and unknown Charm-only strings) are blocked by many IPTV panels, which
  // leaves every tune black+silent while the guide still loads.
  private const val DEFAULT_STREAM_USER_AGENT = "TiviMate/5.1.6 (Linux; Android TV)"

  // Startup deadlines are armed only until the first rendered frame. Healthy
  // playback has no periodic timer capable of stopping or rebuilding it.
  private const val START_TIMEOUT_MS = 30_000L
  // First opaque container guess often hangs without a parse error on Xtream
  // /live/.../id URLs. Rotate sooner than the full start budget so HLS/DASH
  // candidates still get airtime inside one tune.
  private const val OPAQUE_FIRST_CANDIDATE_TIMEOUT_MS = 12_000L
  private const val SOURCE_REFRESH_TIMEOUT_MS = 15_000L
  private const val OPAQUE_CONFIRM_MS = 5_000L
  private const val MAX_ERROR_RECOVERIES = 1
  private const val ERROR_RECOVERY_DELAY_MS = 1_000L
  private const val OPAQUE_PROBE_CACHE_SIZE = 256
  private const val OPAQUE_TYPE_PREFS = "charm_media3_stream_types"
  private val OPAQUE_LIVE_CANDIDATES = listOf("progressive", "hls", "dash")
  private const val TAG = "CharmMedia3"

  // Shared CookieJar with playlist fetch so panel Set-Cookie survives into stream GETs.
  // The HTTP timeout is an inactivity timeout between bytes, never a total
  // duration cap on a healthy live stream.
  private val httpClient = CharmHttpClients.mediaClient()
  private val detectedTypeCache = object : LinkedHashMap<String, String>(64, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?): Boolean = size > OPAQUE_PROBE_CACHE_SIZE
  }
  private val main = Handler(Looper.getMainLooper())
  private var activity: Activity? = null
  private var previewSurface: FrameLayout? = null
  private var fullscreenSurface: FrameLayout? = null
  private var previewPlayerView: PlayerView? = null
  private var fullscreenPlayerView: PlayerView? = null
  private var player: ExoPlayer? = null
  private var mutedState = false
  private var fullscreenResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
  private var listener: Listener? = null
  private var owner: Owner = Owner.NONE
  private var activeSource: PlaybackSource? = null
  private var activeBufferProfile = "stable"
  private var pendingSourceRefresh: SourceRefreshRequest? = null
  private var nextSourceRefreshRequestId = 1L
  private var lastPlaybackError: PlaybackException? = null
  private var firstFrameRendered = false
  private var recoveryAttempts = 0
  private var opaqueRouteSource: PlaybackSource? = null
  private var opaqueRouteCandidates: List<OpaqueAttempt> = emptyList()
  private var opaqueRouteIndex = -1
  private var opaqueRouteCacheKey: String? = null
  private var opaqueRouteWasCached = false
  private var pendingPrepare: PendingPrepare? = null

  private data class OpaqueAttempt(val uri: String, val sourceType: String)

  private data class PendingPrepare(
    val requestedOwner: Owner,
    val channelKey: String,
    val uri: String,
    val headers: Map<String, String>,
    val contentType: String?,
    val bufferProfile: String?,
  )

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
  private var decoderReleaseFailure: Throwable? = null

  private val startupTimeout: Runnable = Runnable {
    if (pendingPrepare != null) {
      pendingPrepare = null
      finishWithError("start-timeout")
      return@Runnable
    }
    val instance = player ?: return@Runnable
    if (owner == Owner.NONE || firstFrameRendered) return@Runnable
    if (ensureActiveSurfaceBound(instance, "startup-timeout")) {
      recordDiagnostic("startup-surface-rebound", lastPlaybackError, instance)
      // Rebinding is not playback success and must not extend the deadline.
    }
    recordDiagnostic("start-timeout", lastPlaybackError, instance)
    // Opaque live URLs can hang on the wrong factory without a parse error.
    // Rotate generic progressive/TS sniffing -> HLS -> DASH before fallback.
    if (advanceOpaqueCandidateOnStall(instance, "start-timeout")) return@Runnable
    recoverOnce(instance, forceFreshSource = false)
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
    finishWithError("stream-error", instance)
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
    when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface = surface
      Owner.FULLSCREEN -> fullscreenSurface = surface
      Owner.NONE -> return@runOnMain
    }
    val video = ensurePlayerViewIn(surfaceOwner, surface)
    unclipVideoAncestors(surface)
    unclipVideoAncestors(video)
    if (owner == surfaceOwner) {
      val instance = player
      // Keep VISIBLE even before the decoder exists so TextureView gets a
      // non-zero layout. GONE children are not measured; Amlogic Onn boxes
      // then keep audio while video stays locked to a 0×0 surface.
      video.visibility = View.VISIBLE
      video.player = instance
      clearInactivePlayerView(surfaceOwner)
      if (instance != null && activeSource != null) {
        instance.playWhenReady = true
        recordDiagnostic("surface-attached", lastPlaybackError, instance)
      }
    }
    // prepare() can race Fabric mount and hit surface-unavailable. Flush any
    // queued tune now that this owner's PlayerView exists.
    val pending = pendingPrepare
    if (pending != null && pending.requestedOwner == surfaceOwner) {
      pendingPrepare = null
      prepare(pending.requestedOwner, pending.channelKey, pending.uri, pending.headers, pending.contentType, pending.bufferProfile)
    }
  }
  fun detachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    val attached = when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    }
    if (attached !== surface) return@runOnMain
    val video = playerViewFor(surfaceOwner)
    val instance = player
    if (owner == surfaceOwner && instance != null) {
      // Unbind the view only. Pausing here is what turned a black-with-audio
      // TextureView into a black-and-silent player after the surface health
      // check rebuilt a 0-size target.
      recordDiagnostic("surface-detached", lastPlaybackError, instance)
    }
    if (video?.parent === surface) {
      try { video.player = null } catch (_: Throwable) {}
    }
    when (surfaceOwner) {
      Owner.PREVIEW -> { previewSurface = null; previewPlayerView = null }
      Owner.FULLSCREEN -> { fullscreenSurface = null; fullscreenPlayerView = null }
      Owner.NONE -> Unit
    }
  }
  fun setResizeMode(mode: String?) = runOnMain {
    fullscreenResizeMode = when (mode) {
      "zoom", "fill" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
    fullscreenPlayerView?.resizeMode = fullscreenResizeMode
  }

  fun prepare(requestedOwner: Owner, channelKey: String, uri: String, headers: Map<String, String>, contentType: String?, bufferProfile: String? = null) = runOnMain {
    if (requestedOwner == Owner.PREVIEW && owner == Owner.FULLSCREEN) {
      pendingPrepare = null
      publishState("error", "owner-reserved")
      return@runOnMain
    }
    cancelRecoveryCallbacks()
    val video = playerViewFor(requestedOwner)
    if (video == null) {
      // Retire the old source before waiting; this pending tune is cancellable
      // even though it does not yet own a decoder or a Fabric surface.
      stopInternal(releasePlayer = true)
      if (decoderReleaseFailure != null) {
        publishState("error", "release-failed")
        return@runOnMain
      }
      // Fabric often mounts the native surface one frame after prepare*. Queue
      // the tune instead of a definitive black+silent surface-unavailable error.
      pendingPrepare = PendingPrepare(
        requestedOwner,
        channelKey.trim(),
        uri,
        LinkedHashMap(headers),
        contentType,
        bufferProfile,
      )
      publishState("loading", "awaiting-surface")
      markPlaybackStarting("awaiting-surface")
      recordDiagnostic("awaiting-surface", lastPlaybackError, player)
      armStartupTimeout()
      return@runOnMain
    }
    pendingPrepare = null
    applyBufferProfile(bufferProfile)
    val instance = try { ensurePlayer() } catch (failure: Exception) {
      recordDiagnostic("player-init-failed:${failure.javaClass.simpleName}", null, null)
      finishWithError("stream-error")
      return@runOnMain
    }

    // Bind the replacement video target before clearing the previous target.
    // Preview <-> fullscreen is a PlayerView handoff, not a stream failure;
    // this order avoids leaving the decoder with no output Surface.
    owner = requestedOwner
    // Fullscreen must never inherit Guide preview mute (mutedState volume 0).
    if (requestedOwner == Owner.FULLSCREEN) {
      mutedState = false
      instance.volume = 1f
    }
    applyAudioAttributes(instance, requestedOwner)
    video.player = instance
    video.resizeMode = if (requestedOwner == Owner.FULLSCREEN) fullscreenResizeMode else AspectRatioFrameLayout.RESIZE_MODE_FIT
    video.visibility = View.VISIBLE
    // Bind the new target first so Media3 never observes a no-surface gap,
    // then detach every inactive target.  `owner` may already be NONE after a
    // soft preview stop, so using previousOwner here leaves the old preview
    // PlayerView attached and produces audio-only/black fullscreen playback.
    clearInactivePlayerView(requestedOwner)
    resetMediaDiagnostics()
    resetOpaqueRoutingState()
    val baseSource = PlaybackSource(channelKey.trim(), uri, LinkedHashMap(headers), contentType?.trim()?.takeIf { it.isNotEmpty() }, sourceTypeFor(uri, contentType))
    activeSource = baseSource
    seedKnownContainerMime(baseSource)
    lastPlaybackError = null
    firstFrameRendered = false
    recoveryAttempts = 0
    markPlaybackStarting("channel-start")
    publishState("loading", null)
    try {
      startOrRouteMediaSource(instance, baseSource, "channel-start")
    } catch (failure: Exception) {
      recordDiagnostic("source-init-failed:${failure.javaClass.simpleName}", null, instance)
      finishWithError("stream-error", instance)
    }
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
      finishWithError("stream-error", instance)
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
      finishWithError("stream-error", instance)
    }
  }

  fun pause() = runOnMain { player?.pause() }
  fun resume() = runOnMain {
    if (owner == Owner.NONE) return@runOnMain
    val instance = player ?: return@runOnMain
    instance.playWhenReady = true
    instance.play()
  }
  fun setMuted(muted: Boolean) = runOnMain { mutedState = muted; player?.volume = if (muted) 0f else 1f }
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
  fun stop(requestedOwner: Owner, releasePlayer: Boolean = false, onStopped: ((Throwable?) -> Unit)? = null) = runOnMain {
    if (currentOwner() != requestedOwner && decoderReleaseFailure == null) { onStopped?.invoke(null); return@runOnMain }
    stopInternal(releasePlayer); onStopped?.invoke(decoderReleaseFailure)
  }
  fun suspendForBackground() = runOnMain { stopInternal(releasePlayer = true) }
  fun releaseAll() = runOnMain {
    pendingPrepare = null
    stopInternal(releasePlayer = true)
    try { previewPlayerView?.player = null } catch (_: Throwable) {}
    try { fullscreenPlayerView?.player = null } catch (_: Throwable) {}
    listener = null; activity = null; previewSurface = null; fullscreenSurface = null
    previewPlayerView = null; fullscreenPlayerView = null
  }
  fun currentOwner(): Owner = pendingPrepare?.requestedOwner ?: owner
  fun hasReleaseFailure(): Boolean = decoderReleaseFailure != null

  private fun publishState(state: String, reason: String? = null) { listener?.onState(state, reason) }
  private fun stopInternal(releasePlayer: Boolean) {
    val previousOwner = currentOwner()
    pendingPrepare = null
    cancelRecoveryCallbacks()
    val instance = player
    var stopFailed = false
    try { instance?.stop() } catch (_: Throwable) { stopFailed = true }
    try { instance?.clearMediaItems() } catch (_: Throwable) { stopFailed = true }
    if (releasePlayer || stopFailed || decoderReleaseFailure != null) releaseDecoder(instance)
    owner = if (decoderReleaseFailure == null) Owner.NONE else previousOwner
    activeSource = null; lastPlaybackError = null; firstFrameRendered = false; recoveryAttempts = 0
    resetMediaDiagnostics()
    resetOpaqueRoutingState()
    CharmMemoryCoordinator.setPlaybackStarting(false)
    // A soft stop intentionally retains ExoPlayer for the imminent
    // preview/fullscreen handoff, not its old SurfaceView.  Always unbind all
    // targets before returning so a retired preview cannot steal video output
    // or leave a healthy transport stream rendering into a retired host.
    clearAllPlayerViews()
  }

  // Never acknowledge decoder release after a platform exception. Retain the
  // reference so the coordinator can retry cleanup without starting VLC.
  private fun releaseDecoder(instance: ExoPlayer?): Boolean = try {
    instance?.release()
    if (player === instance) player = null
    decoderReleaseFailure = null
    true
  } catch (failure: Throwable) {
    decoderReleaseFailure = failure
    false
  }

  private fun ensurePlayer(): ExoPlayer {
    check(decoderReleaseFailure == null) { "Previous decoder release failed" }
    player?.let { return it }
    val context = activity ?: throw IllegalStateException("Playback surface is not attached")
    val lowRam = CharmMemoryCoordinator.budgets().lowRam
    val durations = tivimateBufferDurationsMs(activeBufferProfile, lowRam)
    val loadControl = DefaultLoadControl.Builder().setBufferDurationsMs(
      durations[0], durations[1], durations[2], durations[3],
    ).setTargetBufferBytes(if (lowRam) TARGET_BUFFER_BYTES_LOW_RAM else TARGET_BUFFER_BYTES_NORMAL).setPrioritizeTimeOverSizeThresholds(false).build()
    val renderers = DefaultRenderersFactory(context)
      // Prefer the bundled LGPL FFmpeg audio renderer for AC3/E-AC3/DTS/
      // TrueHD rather than repeatedly selecting an OEM decoder that advertises
      // support but produces silence. Video remains on MediaCodec hardware.
      .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
      .setEnableDecoderFallback(true)
      // Onn Google TV (Amlogic) often emits no video frames with forced async
      // MediaCodec queueing while audio continues. Disable async so hardware
      // video can paint; FFmpeg remains the audio extension fallback.
      .forceDisableMediaCodecAsynchronousQueueing()
    return ExoPlayer.Builder(context, renderers)
      .setLoadControl(loadControl)
      .setMediaSourceFactory(DefaultMediaSourceFactory(createDataSourceFactory(emptyMap())))
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build().also { created ->
        player = created
        applyAudioAttributes(created, owner)
        created.volume = if (mutedState) 0f else 1f
        created.playWhenReady = true
        created.addListener(object : Player.Listener {
          override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
              Player.STATE_BUFFERING -> {
                if (!created.isPlaying) publishState("loading", null)
              }
              Player.STATE_READY -> {
                ensureActiveSurfaceBound(created, "state-ready")
                publishTracks(created.currentTracks)
                markAudioOnlyReady(created)
              }
              Player.STATE_ENDED -> {
                recordDiagnostic("stream-ended", lastPlaybackError, created)
                recoverOnce(created, forceFreshSource = false)
              }
              else -> Unit
            }
          }
          override fun onRenderedFirstFrame() {
            firstFrameRendered = true
            main.removeCallbacks(startupTimeout)
            main.removeCallbacks(delayedRecovery)
            main.removeCallbacks(opaqueTypeConfirmation)
            if (opaqueRouteCacheKey != null) main.postDelayed(opaqueTypeConfirmation, OPAQUE_CONFIRM_MS)
            CharmMemoryCoordinator.setPlaybackStarting(false)
            recordDiagnostic("first-frame", lastPlaybackError, created)
            publishState("playing", null)
          }
          override fun onPlayerError(error: PlaybackException) {
            lastPlaybackError = error
            main.removeCallbacks(startupTimeout)
            main.removeCallbacks(opaqueTypeConfirmation)
            recordDiagnostic("player-error", error, created)
            if (tryNextOpaqueCandidate(created, error)) return
            recoverOnce(
              created,
              forceFreshSource = isAuthenticationFailure(error),
            )
          }
          override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!firstFrameRendered) return
            if (isPlaying) {
              publishState("playing", null)
            }
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

  private fun playerViewFor(target: Owner): PlayerView? = when (target) {
    Owner.PREVIEW -> previewPlayerView
    Owner.FULLSCREEN -> fullscreenPlayerView
    Owner.NONE -> null
  }

  /**
   * ExoPlayer owns one decoder and therefore must expose one active video
   * target.  The replacement target is always bound before this runs.
   */
  private fun clearInactivePlayerView(activeOwner: Owner) {
    val inactive = when (activeOwner) {
      Owner.PREVIEW -> fullscreenPlayerView
      Owner.FULLSCREEN -> previewPlayerView
      Owner.NONE -> null
    }
    try { inactive?.player = null } catch (_: Throwable) {}
    inactive?.visibility = View.GONE
  }

  private fun clearAllPlayerViews() {
    for (video in arrayOf(previewPlayerView, fullscreenPlayerView)) {
      try { video?.player = null } catch (_: Throwable) {}
      video?.visibility = View.GONE
    }
  }

  private fun ensureActiveSurfaceBound(instance: ExoPlayer, event: String): Boolean {
    val activeOwner = owner
    if (activeOwner == Owner.NONE || player !== instance) return false
    val target = when (activeOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    } ?: return false
    val video = ensurePlayerViewIn(activeOwner, target)
    if (video.player === instance && video.visibility == View.VISIBLE) {
      clearInactivePlayerView(activeOwner)
      return false
    }
    return try {
      video.player = instance
      video.visibility = View.VISIBLE
      clearInactivePlayerView(activeOwner)
      if (activeSource != null) instance.playWhenReady = true
      recordDiagnostic("surface-rebind:$event", lastPlaybackError, instance)
      true
    } catch (failure: Throwable) {
      Log.w(TAG, "surface rebind failed: $event", failure)
      false
    }
  }

  private fun applyAudioAttributes(instance: ExoPlayer, surfaceOwner: Owner) {
    // Match PR #23 expo-video: fullscreen takes AUDIOFOCUS_GAIN / doNotMix;
    // preview mixes so it cannot steal the TV's audio session.
    instance.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
        .build(),
      surfaceOwner == Owner.FULLSCREEN,
    )
  }

  private fun ensurePlayerViewIn(surfaceOwner: Owner, target: FrameLayout): PlayerView {
    playerViewFor(surfaceOwner)?.let { existing ->
      if (existing.parent === target) {
        existing.visibility = View.VISIBLE
        unclipVideoAncestors(existing)
        return existing
      }
    }
    val video = (LayoutInflater.from(target.context).inflate(R.layout.charm_player_view, target, false) as PlayerView).apply {
      useController = false
      clipChildren = false
      clipToPadding = false
      setBackgroundColor(Color.TRANSPARENT)
      setShutterBackgroundColor(Color.TRANSPARENT)
      setUseArtwork(false)
      setKeepContentOnPlayerReset(true)
      resizeMode = if (surfaceOwner == Owner.FULLSCREEN) fullscreenResizeMode else AspectRatioFrameLayout.RESIZE_MODE_FIT
      visibility = View.VISIBLE
      setLayerType(View.LAYER_TYPE_NONE, null)
      (videoSurfaceView as? TextureView)?.let { texture ->
        texture.isOpaque = true
        texture.setLayerType(View.LAYER_TYPE_NONE, null)
      }
    }
    target.addView(video, fillParent())
    unclipVideoAncestors(target)
    unclipVideoAncestors(video)
    when (surfaceOwner) {
      Owner.PREVIEW -> previewPlayerView = video
      Owner.FULLSCREEN -> fullscreenPlayerView = video
      Owner.NONE -> Unit
    }
    return video
  }

  private fun recoverOnce(instance: ExoPlayer, forceFreshSource: Boolean = false): Boolean {
    if (owner == Owner.NONE || player !== instance) return false
    if (recoveryAttempts >= MAX_ERROR_RECOVERIES) {
      finishWithError("stream-error", instance)
      return false
    }
    recoveryAttempts += 1
    cancelRecoveryCallbacks()
    markPlaybackStarting("error-recovery")
    recordDiagnostic("error-recovery-scheduled", lastPlaybackError, instance)
    publishState("loading", "native-reprepare")
    if (forceFreshSource) {
      requestFreshSource(instance, activeSource)
      return true
    }
    main.postDelayed(delayedRecovery, ERROR_RECOVERY_DELAY_MS)
    return true
  }
  private fun performRecovery(instance: ExoPlayer): Boolean {
    if (owner == Owner.NONE || player !== instance) return false
    val source = activeSource
    return try {
      fullPlayerAndSourceRecovery(instance, source)
      true
    } catch (t: Throwable) {
      recordDiagnostic("error-recovery-failed:${t.javaClass.simpleName}", lastPlaybackError, instance)
      finishWithError("stream-error", instance)
      false
    }
  }
  private fun requestFreshSource(instance: ExoPlayer, source: PlaybackSource?) {
    if (source == null || source.channelKey.isBlank()) {
      recordDiagnostic("source-refresh-unavailable", lastPlaybackError, instance)
      finishWithError("stream-error", instance)
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
    val video = playerViewFor(owner) ?: throw IllegalStateException("Playback surface is unavailable")
    try { video.player = null } catch (_: Throwable) {}
    check(releaseDecoder(instance)) { "Previous decoder release failed" }
    firstFrameRendered = false
    val rebuilt = ensurePlayer()
    video.player = rebuilt
    rebuildMediaSource(rebuilt, source, "full-player-source-recovery")
  }

  private fun startOrRouteMediaSource(instance: ExoPlayer, source: PlaybackSource, event: String) {
    val opaqueUri = isOpaqueHttpUri(source.uri)
    // Extensionless live IPTV must always stay on the opaque candidate ladder.
    // A wrong locked hls/dash/transport hint used to skip rotation and hang
    // black for the full start timeout (TiViMate-class panels still deliver).
    if (!opaqueUri && (source.sourceType != "unknown" || !isHttpOrHttps(source.uri))) {
      resetOpaqueRoutingState()
      val routed = if (source.sourceType == "unknown") source.copy(sourceType = "progressive") else source
      activeSource = routed
      seedKnownContainerMime(routed)
      rebuildMediaSource(instance, routed, event)
      return
    }
    if (!isHttpOrHttps(source.uri)) {
      resetOpaqueRoutingState()
      val routed = source.copy(sourceType = if (source.sourceType == "unknown") "progressive" else source.sourceType)
      activeSource = routed
      seedKnownContainerMime(routed)
      rebuildMediaSource(instance, routed, event)
      return
    }

    val cacheKey = detectedTypeCacheKey(source)
    val cachedType = readDetectedType(cacheKey)

    val firstType = when {
      cachedType != null && isPersistableDetectedType(cachedType) -> cachedType
      isPersistableDetectedType(source.sourceType) -> source.sourceType
      else -> "progressive"
    }
    val fromCache = cachedType != null
    probeReason = "direct:$firstType"
    resolvedUri = redactUriForDiagnostics(source.uri)
    recordDiagnostic("opaque-direct-start", lastPlaybackError, instance)
    startOpaqueCandidate(instance, source, cacheKey, firstType, "$event-opaque-$firstType", fromCache = fromCache)
  }

  private fun startOpaqueCandidate(instance: ExoPlayer, source: PlaybackSource, cacheKey: String, firstType: String, event: String, fromCache: Boolean) {
    main.removeCallbacks(opaqueTypeConfirmation)
    opaqueRouteSource = source
    opaqueRouteCacheKey = cacheKey
    opaqueRouteWasCached = fromCache
    opaqueRouteCandidates = buildOpaqueAttempts(source, firstType)
    opaqueRouteIndex = 0
    val first = opaqueRouteCandidates.first()
    val routed = source.copy(uri = first.uri, sourceType = first.sourceType)
    activeSource = routed
    detectedMimeType = knownMimeForSource(routed)
    resolvedUri = redactUriForDiagnostics(routed.uri)
    rebuildMediaSource(instance, routed, event)
  }

  private fun tryNextOpaqueCandidate(instance: ExoPlayer, error: PlaybackException): Boolean {
    if (!isContainerMismatch(error)) return false
    return advanceOpaqueCandidate(instance, "parser", error)
  }

  /** Advance the MediaSource type on startup hang without changing the provider URL. */
  private fun advanceOpaqueCandidateOnStall(instance: ExoPlayer, reason: String): Boolean =
    advanceOpaqueCandidate(instance, "stall:$reason", lastPlaybackError)

  private fun advanceOpaqueCandidate(instance: ExoPlayer, reason: String, error: PlaybackException?): Boolean {
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
    val next = opaqueRouteCandidates[nextIndex]
    val routed = original.copy(uri = next.uri, sourceType = next.sourceType)
    activeSource = routed
    detectedMimeType = knownMimeForSource(routed)
    resolvedUri = redactUriForDiagnostics(routed.uri)
    probeReason = "${probeReason ?: "opaque"};$reason-retry:${next.sourceType}:${redactUriForDiagnostics(next.uri)}"
    // Container classification shares the one recovery budget for this tune.
    lastPlaybackError = null
    recordDiagnostic("opaque-type-retry-${next.sourceType}", error, instance)
    return try {
      rebuildMediaSource(instance, routed, "opaque-type-retry-${next.sourceType}")
      true
    } catch (failure: Throwable) {
      recordDiagnostic("opaque-type-retry-failed:${failure.javaClass.simpleName}", error, instance)
      false
    }
  }

  /** Keep the exact URL supplied by the playlist; only the demuxer changes. */
  private fun buildOpaqueAttempts(source: PlaybackSource, firstType: String): List<OpaqueAttempt> {
    return orderedOpaqueCandidates(firstType).map { type -> OpaqueAttempt(source.uri, type) }
  }

  private fun rebuildMediaSource(instance: ExoPlayer, source: PlaybackSource, event: String) {
    markPlaybackStarting(event)
    val item = buildMediaItem(source)
    val mediaSource = buildMediaSource(item, source)
    firstFrameRendered = false
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
    if (Uri.parse(source.uri).scheme.equals("rtsp", ignoreCase = true)) {
      // RTSP has its own transport and does not use the OkHttp factory.
      require(source.headers.keys.all { it.equals("User-Agent", ignoreCase = true) }) { "RTSP custom headers are unsupported" }
      val userAgent = source.headers.entries.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }?.value ?: DEFAULT_STREAM_USER_AGENT
      return RtspMediaSource.Factory().setUserAgent(userAgent).createMediaSource(item)
    }
    val dataSource = createDataSourceFactory(source.headers)
    val liveTsFlags =
      DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
        DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
    return when (source.sourceType) {
      // IPTV HLS almost always carries MPEG-TS segments. Without these demuxer
      // flags Media3 can decode audio and never emit video (black + silent or
      // audio-only), which matches the TiViMate-class live extractor contract.
      "hls" -> HlsMediaSource.Factory(dataSource)
        .setExtractorFactory(DefaultHlsExtractorFactory(liveTsFlags, true))
        .createMediaSource(item)
      "dash" -> DashMediaSource.Factory(dataSource).createMediaSource(item)
      "transport" -> ProgressiveMediaSource.Factory(dataSource, createLiveTsExtractorsFactory()).createMediaSource(item)
      // Opaque last-resort "progressive" is often still live MPEG-TS without a
      // file extension. Keep the live-TS flags so this candidate is not a
      // guaranteed black/silent dead end.
      "progressive" -> {
        if (opaqueRouteCacheKey != null || isOpaqueHttpUri(source.uri)) {
          ProgressiveMediaSource.Factory(dataSource, createLiveTsExtractorsFactory()).createMediaSource(item)
        } else {
          DefaultMediaSourceFactory(dataSource).createMediaSource(item)
        }
      }
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
    val properties = LinkedHashMap<String, String>(headers.size + 2)
    if (headers.keys.none { it.equals("User-Agent", ignoreCase = true) }) {
      properties["User-Agent"] = DEFAULT_STREAM_USER_AGENT
    }
    // Match ordinary IPTV clients / playlist fetch: panels that inspect Accept
    // often reject bare OkHttp defaults.
    if (headers.keys.none { it.equals("Accept", ignoreCase = true) }) {
      properties["Accept"] = "*/*"
    }
    properties.putAll(headers)
    val client = CharmHttpClients.mediaClientForHeaders(httpClient, properties)
    return DefaultDataSource.Factory(context, OkHttpDataSource.Factory(client).setDefaultRequestProperties(properties))
  }
  private fun finishWithError(reason: String, instance: ExoPlayer? = player) {
    pendingPrepare = null
    cancelRecoveryCallbacks()
    recordDiagnostic("definitive-$reason", lastPlaybackError, instance)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    if (instance != null && player === instance) {
      try { playerViewFor(owner)?.player = null } catch (_: Throwable) {}
      releaseDecoder(instance)
    }
    publishState("error", reason)
    if (decoderReleaseFailure == null) owner = Owner.NONE
    activeSource = null
    firstFrameRendered = false
  }
  private fun cancelRecoveryCallbacks() {
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    main.removeCallbacks(sourceRefreshTimeout)
    main.removeCallbacks(opaqueTypeConfirmation)
    pendingSourceRefresh = null
  }
  private fun resetOpaqueRoutingState() {
    main.removeCallbacks(opaqueTypeConfirmation)
    opaqueRouteSource = null
    opaqueRouteCandidates = emptyList()
    opaqueRouteIndex = -1
    opaqueRouteCacheKey = null
    opaqueRouteWasCached = false
  }
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
    val opaque = isOpaqueHttpUri(uri)
    return when {
      hint == "hls" || hint == "m3u8" || hint == MimeTypes.APPLICATION_M3U8 || hint == "application/x-mpegurl" || hint == "application/vnd.apple.mpegurl" || hlsUri -> "hls"
      hint == "dash" || hint == "mpd" || hint == MimeTypes.APPLICATION_MPD || hint == "application/dash+xml" || dashUri -> "dash"
      hint == "transport" || hint == "ts" || hint == MimeTypes.VIDEO_MP2T || transportUri -> "transport"
      // Extensionless live IPTV (Xtream-style) must stay unknown so the opaque
      // generic progressive/TS sniffing → HLS → DASH router runs. A stale
      // forced type can skip the correct source factory and yield black+silent.
      progressiveUri -> "progressive"
      hint == "progressive" && !opaque -> "progressive"
      hint == "unknown" && isHttpOrHttps(uri) -> "unknown"
      opaque || (hint.isEmpty() && isHttpOrHttps(uri)) -> "unknown"
      else -> "progressive"
    }
  }
  private fun isHttpOrHttps(uri: String): Boolean = CharmStreamUrls.isHttpOrHttps(uri)
  private fun isOpaqueHttpUri(uri: String): Boolean = CharmStreamUrls.isOpaqueHttpUri(uri)
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
      // Even a final path segment can be a provider password or signed token.
      "$scheme://$host/…"
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
  private fun applyBufferProfile(raw: String?) {
    val next = when (raw?.trim()?.lowercase()) {
      "low_latency", "small" -> "low_latency"
      "balanced", "medium" -> "balanced"
      else -> "stable"
    }
    if (next == activeBufferProfile) return
    activeBufferProfile = next
    // LoadControl is construction-only. Unbind PlayerViews before releasing so
    // MediaCodec is never left attached to a dead ExoPlayer (black + silent).
    val existing = player ?: return
    try { previewPlayerView?.player = null } catch (_: Throwable) {}
    try { fullscreenPlayerView?.player = null } catch (_: Throwable) {}
    releaseDecoder(existing)
  }

  /** Small / Medium / Large -> bounded live-TV LoadControl durations. */
  private fun tivimateBufferDurationsMs(profile: String, lowRam: Boolean): IntArray {
    val durations = when (profile) {
      "low_latency" -> intArrayOf(1_000, 5_000, 500, 1_000)
      "balanced" -> intArrayOf(3_000, 15_000, 1_000, 2_000)
      else -> intArrayOf(10_000, 30_000, 1_500, 3_000)
    }
    if (lowRam) durations[1] = minOf(durations[1], 15_000)
    return durations
  }

  private fun armStartupTimeout() {
    main.removeCallbacks(startupTimeout)
    if (owner == Owner.NONE && pendingPrepare == null) return
    val opaqueFirst =
      opaqueRouteCacheKey != null &&
        opaqueRouteIndex == 0 &&
        opaqueRouteCandidates.size > 1
    val delayMs = if (opaqueFirst) OPAQUE_FIRST_CANDIDATE_TIMEOUT_MS else START_TIMEOUT_MS
    main.postDelayed(startupTimeout, delayMs)
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
  private fun markAudioOnlyReady(instance: ExoPlayer) {
    if (firstFrameRendered || instance.playbackState != Player.STATE_READY) return
    val groups = instance.currentTracks.groups
    val hasVideo = groups.any { it.type == C.TRACK_TYPE_VIDEO && it.length > 0 }
    val hasSelectedAudio = groups.any { it.type == C.TRACK_TYPE_AUDIO && it.isSelected }
    if (hasVideo || !hasSelectedAudio) return
    // Radio/audio-only playlist entries never render a video frame. Treat a
    // selected, READY audio track as startup success without masking a broken
    // or unsupported video track.
    firstFrameRendered = true
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    main.removeCallbacks(opaqueTypeConfirmation)
    if (opaqueRouteCacheKey != null) main.postDelayed(opaqueTypeConfirmation, OPAQUE_CONFIRM_MS)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    recordDiagnostic("audio-only-ready", lastPlaybackError, instance)
    publishState("playing", null)
  }
  private fun fillParent() = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
  private fun runOnMain(block: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block) }
}
