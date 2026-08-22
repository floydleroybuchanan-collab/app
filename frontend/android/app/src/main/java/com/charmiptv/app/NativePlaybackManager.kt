package com.charmiptv.app

import android.app.Activity
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
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
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
import java.util.concurrent.TimeUnit

@OptIn(UnstableApi::class)
object NativePlaybackManager {
  enum class Owner { NONE, PREVIEW, FULLSCREEN }

  data class AudioTrackInfo(val groupIndex: Int, val trackIndex: Int, val id: String, val label: String, val language: String?, val mimeType: String?, val supported: Boolean)
  data class SubtitleTrackInfo(val groupIndex: Int, val trackIndex: Int, val id: String, val label: String, val language: String?)
  data class SourceRefreshRequest(val requestId: Long, val owner: Owner, val channelKey: String, val recoveryAttempt: Int, val reason: String, val authenticationFailure: Boolean)
  data class PlaybackDiagnostic(
    val event: String, val media3ErrorCode: Int?, val media3ErrorCodeName: String?, val httpResponseCode: Int?, val exceptionType: String?, val causeChain: List<String>,
    val playbackState: String, val bufferedDurationMs: Long, val bufferedPositionMs: Long, val positionMs: Long, val contentType: String?, val sourceType: String?,
    val recoveryAttempt: Int, val lowRam: Boolean, val heapUsedBytes: Long, val heapMaxBytes: Long, val epgRamStats: Map<String, Long>,
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
  private const val TAG = "CharmMedia3"

  private val httpClient = OkHttpClient.Builder()
    .connectionPool(ConnectionPool(6, 5, TimeUnit.MINUTES))
    .connectTimeout(8, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .writeTimeout(15, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()
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

  private val stableRecoveryRearm = Runnable {
    val instance = player ?: return@Runnable
    if (owner == Owner.NONE || !firstFrameRendered || instance.playbackState != Player.STATE_READY) return@Runnable
    recoveryAttempts = 0
    stableSinceMs = 0L
    recordDiagnostic("recovery-budget-rearmed", lastPlaybackError, instance)
  }
  private val startupTimeout = Runnable {
    val instance = player ?: return@Runnable
    if (owner == Owner.NONE || firstFrameRendered) return@Runnable
    recordDiagnostic("start-timeout", lastPlaybackError, instance)
    recoverOnce(instance, skipBarePrepare = activeSource?.sourceType == "transport")
  }
  private val bufferingWatchdog = Runnable {
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
    activeSource = PlaybackSource(channelKey.trim(), uri, LinkedHashMap(headers), contentType?.trim()?.takeIf { it.isNotEmpty() }, sourceTypeFor(uri, contentType))
    lastPlaybackError = null
    firstFrameRendered = false
    recoveryAttempts = 0
    stableSinceMs = 0L
    resetBufferingWatchdogState()
    markPlaybackStarting("channel-start")
    if (!attachPlayerView(requestedOwner)) { finishWithError("surface-unavailable", instance); return@runOnMain }
    playerView?.visibility = View.VISIBLE
    publishState("loading", null)
    rebuildMediaSource(instance, activeSource!!, "channel-start")
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
    activeSource = PlaybackSource(source.channelKey, uri, LinkedHashMap(headers), contentType?.trim()?.takeIf { it.isNotEmpty() } ?: source.contentType, sourceTypeFor(uri, contentType ?: source.contentType))
    markPlaybackStarting("fresh-source")
    recordDiagnostic("fresh-source-received", lastPlaybackError, instance)
    try {
      rebuildMediaSource(instance, activeSource!!, "fresh-source")
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
                main.removeCallbacks(stableRecoveryRearm)
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
                main.removeCallbacks(stableRecoveryRearm)
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
            main.removeCallbacks(stableRecoveryRearm)
            main.postDelayed(stableRecoveryRearm, STABLE_REARM_MS)
            resetBufferingWatchdogState()
            CharmMemoryCoordinator.setPlaybackStarting(false)
            publishState("playing", null)
          }
          override fun onPlayerError(error: PlaybackException) {
            lastPlaybackError = error
            main.removeCallbacks(startupTimeout)
            main.removeCallbacks(bufferingWatchdog)
            main.removeCallbacks(stableRecoveryRearm)
            resetBufferingWatchdogState()
            recordDiagnostic("player-error", error, created)
            rearmRecoveryAfterStablePlayback()
            recoverOnce(
              created,
              forceFreshSource = isAuthenticationFailure(error),
              skipBarePrepare = activeSource?.sourceType == "transport",
            )
          }
          override fun onTracksChanged(tracks: Tracks) = publishTracks(tracks)
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
  private fun rebuildMediaSource(instance: ExoPlayer, source: PlaybackSource, event: String) {
    markPlaybackStarting(event)
    val item = buildMediaItem(source)
    val mediaSource = buildMediaSource(item, source)
    firstFrameRendered = false
    main.removeCallbacks(bufferingWatchdog)
    main.removeCallbacks(stableRecoveryRearm)
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
    main.removeCallbacks(stableRecoveryRearm)
    pendingSourceRefresh = null
    resetBufferingWatchdogState()
  }
  private fun resetBufferingWatchdogState() { bufferingSinceMs = 0L; bufferingLastBufferedPositionMs = 0L; bufferingLastPositionMs = 0L }
  private fun markPlaybackStarting(reason: String) { CharmMemoryCoordinator.setPlaybackStarting(true); Log.d(TAG, "playback-starting: $reason") }
  private fun isAuthenticationFailure(error: PlaybackException?): Boolean = findHttpResponseCode(error) in setOf(401, 403)
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
    val hint = contentType?.lowercase().orEmpty()
    val lowerUri = uri.lowercase()
    val transportUri = Regex("\\.(?:ts|m2ts)(?:$|[?#])").containsMatchIn(lowerUri) || lowerUri.contains("mpegts") || lowerUri.contains("mpeg-ts") || Regex("[?&](?:format|type|output)=(?:ts|mpegts|mpeg-ts)(?:&|$)").containsMatchIn(lowerUri)
    return when {
      hint == "hls" || hint == "m3u8" || hint == MimeTypes.APPLICATION_M3U8 || lowerUri.contains(".m3u8") || lowerUri.contains("format=m3u8") -> "hls"
      hint == "dash" || hint == "mpd" || hint == MimeTypes.APPLICATION_MPD || lowerUri.contains(".mpd") || lowerUri.contains("format=mpd") -> "dash"
      hint == "transport" || hint == "ts" || hint == MimeTypes.VIDEO_MP2T || transportUri -> "transport"
      else -> "progressive"
    }
  }
  private fun recordDiagnostic(event: String, error: PlaybackException?, instance: ExoPlayer?) {
    val runtime = Runtime.getRuntime()
    val bufferedPosition = instance?.bufferedPosition ?: 0L
    val position = instance?.currentPosition ?: 0L
    val diagnostic = PlaybackDiagnostic(event, error?.errorCode, error?.errorCodeName, findHttpResponseCode(error), error?.cause?.javaClass?.name, causeChain(error), playbackStateName(instance), (bufferedPosition - position).coerceAtLeast(0L), bufferedPosition, position, activeSource?.contentType, activeSource?.sourceType, recoveryAttempts, CharmMemoryCoordinator.budgets().lowRam, runtime.totalMemory() - runtime.freeMemory(), runtime.maxMemory(), CharmEpgRamDiagnostics.stats())
    Log.w(TAG, "event=${diagnostic.event} code=${diagnostic.media3ErrorCodeName} http=${diagnostic.httpResponseCode} state=${diagnostic.playbackState} buffered=${diagnostic.bufferedDurationMs}ms source=${diagnostic.sourceType} attempt=${diagnostic.recoveryAttempt} lowRam=${diagnostic.lowRam} heap=${diagnostic.heapUsedBytes}/${diagnostic.heapMaxBytes} causes=${diagnostic.causeChain.joinToString(" <- ")}")
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
