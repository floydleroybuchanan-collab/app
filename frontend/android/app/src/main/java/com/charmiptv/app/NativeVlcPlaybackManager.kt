package com.charmiptv.app

import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout

/**
 * TiViMate-class LibVLC live engine.
 *
 * Media3 is the default. This compatibility engine is entered only after the
 * serialized coordinator has fully released Media3, or when Settings forces it.
 * The exact provider URL is retained from playlist to player.
 *
 * Onn / Amlogic: never play without a measured host surface, and never inherit
 * Guide preview mute into fullscreen (same contract as NativePlaybackManager).
 */
object NativeVlcPlaybackManager {
  enum class Owner { NONE, PREVIEW, FULLSCREEN }

  data class Identity(
    val owner: Owner,
    val generation: Long,
    val channelKey: String,
  )

  data class TrackInfo(val id: Int, val label: String)

  private data class PlaybackSource(
    val uri: String,
    val headers: Map<String, String>,
    val hardwareDecode: Boolean,
    val audioOutput: String,
    val bufferProfile: String,
  )

  private data class PendingPrepare(
    val requestedOwner: Owner,
    val generation: Long,
    val channelKey: String,
    val uri: String,
    val headers: Map<String, String>,
    val hardwareDecode: Boolean,
    val audioOutput: String,
    val bufferProfile: String,
  )

  interface Listener {
    fun onState(identity: Identity, state: String, reason: String? = null)
    fun onTracks(identity: Identity, audio: List<TrackInfo>, subtitles: List<TrackInfo>)
  }

  private const val START_TIMEOUT_MS = 30_000L
  private const val MAX_ERROR_RECOVERIES = 1
  private const val ERROR_RECOVERY_DELAY_MS = 1_000L
  private const val TAG = "CharmVlc"

  private val main = Handler(Looper.getMainLooper())
  private var activity: Activity? = null
  private var libVlc: LibVLC? = null
  private var mediaPlayer: MediaPlayer? = null
  private var videoLayout: VLCVideoLayout? = null
  private var previewSurface: FrameLayout? = null
  private var fullscreenSurface: FrameLayout? = null
  private var owner = Owner.NONE
  private var activeIdentity: Identity? = null
  private var activeSource: PlaybackSource? = null
  private var pendingPrepare: PendingPrepare? = null
  private var listener: Listener? = null
  private var playing = false
  private var mutedState = false
  private var recoveryAttempts = 0
  private var resizeMode = "fit"

  private val startupTimeout: Runnable = Runnable {
    val pending = pendingPrepare
    if (pending != null) {
      pendingPrepare = null
      listener?.onState(
        Identity(pending.requestedOwner, pending.generation, pending.channelKey),
        "error",
        "start-timeout",
      )
      return@Runnable
    }
    val identity = activeIdentity ?: return@Runnable
    if (playing || owner == Owner.NONE) return@Runnable
    if (recoverOnce(identity, "start-timeout")) return@Runnable
    finishWithError(identity, "start-timeout")
  }

  private val delayedRecovery = Runnable {
    val identity = activeIdentity ?: return@Runnable
    val source = activeSource ?: return@Runnable
    performReconnect(identity, source)
  }

  fun installIntoActivity(next: Activity) = runOnMain { activity = next }

  fun setListener(next: Listener?) = runOnMain { listener = next }

  fun currentOwner(): Owner = pendingPrepare?.requestedOwner ?: owner
  fun hasReleaseFailure(): Boolean = decoderReleaseFailure != null
  private var decoderReleaseFailure: Throwable? = null

  fun attachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface = surface
      Owner.FULLSCREEN -> fullscreenSurface = surface
      Owner.NONE -> return@runOnMain
    }
    unclipVideoAncestors(surface)
    // prepare() can race Fabric mount. Flush any queued tune once the host exists.
    val pending = pendingPrepare
    if (pending != null && pending.requestedOwner == surfaceOwner) {
      pendingPrepare = null
      prepare(
        pending.requestedOwner,
        pending.generation,
        pending.channelKey,
        pending.uri,
        pending.headers,
        pending.hardwareDecode,
        pending.audioOutput,
        pending.bufferProfile,
      )
      return@runOnMain
    }
    if (owner != surfaceOwner || mediaPlayer == null) return@runOnMain
    if (attachVideoLayout(surfaceOwner)) {
      try { mediaPlayer?.play() } catch (_: Throwable) {}
      if (!playing) {
        main.removeCallbacks(startupTimeout)
        main.postDelayed(startupTimeout, START_TIMEOUT_MS)
        activeIdentity?.let { listener?.onState(it, "loading", "surface-attached") }
      }
    }
  }

  fun detachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    val attached = when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    }
    if (attached !== surface) return@runOnMain

    if (owner == surfaceOwner) {
      try { mediaPlayer?.detachViews() } catch (_: Throwable) {}
    }
    if (videoLayout?.parent === surface) surface.removeView(videoLayout)
    when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface = null
      Owner.FULLSCREEN -> fullscreenSurface = null
      Owner.NONE -> Unit
    }
  }

  fun prepare(
    requestedOwner: Owner,
    nextGeneration: Long,
    nextChannelKey: String,
    uri: String,
    headers: Map<String, String>,
    hardwareDecode: Boolean,
    audioOutput: String,
    bufferProfile: String,
  ) = runOnMain {
    if (requestedOwner == Owner.PREVIEW && owner == Owner.FULLSCREEN) {
      pendingPrepare = null
      listener?.onState(Identity(requestedOwner, nextGeneration, nextChannelKey.trim()), "error", "owner-reserved")
      return@runOnMain
    }

    val host = surfaceFor(requestedOwner)
    if (host == null) {
      stopInternal(releasePlayer = true)
      if (decoderReleaseFailure != null) {
        listener?.onState(Identity(requestedOwner, nextGeneration, nextChannelKey.trim()), "error", "release-failed")
        return@runOnMain
      }
      // Fabric often mounts the native surface one frame after prepare*. Queue
      // the tune instead of decoding into a missing / 0×0 TextureView.
      pendingPrepare = PendingPrepare(
        requestedOwner,
        nextGeneration,
        nextChannelKey.trim(),
        uri,
        LinkedHashMap(headers),
        hardwareDecode,
        audioOutput,
        bufferProfile,
      )
      listener?.onState(
        Identity(requestedOwner, nextGeneration, nextChannelKey.trim()),
        "loading",
        "awaiting-surface",
      )
      main.removeCallbacks(startupTimeout)
      main.postDelayed(startupTimeout, START_TIMEOUT_MS)
      return@runOnMain
    }
    pendingPrepare = null

    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    if (!releasePlayerOnly(removeLayout = false)) {
      listener?.onState(Identity(requestedOwner, nextGeneration, nextChannelKey.trim()), "error", "release-failed")
      return@runOnMain
    }

    owner = requestedOwner
    // Fullscreen must never inherit Guide preview mute (mutedState volume 0).
    if (requestedOwner == Owner.FULLSCREEN) {
      mutedState = false
    }
    playing = false
    recoveryAttempts = 0
    CharmMemoryCoordinator.setPlaybackStarting(true)
    val identity = Identity(requestedOwner, nextGeneration, nextChannelKey.trim())
    activeIdentity = identity
    val source = PlaybackSource(
      uri = uri,
      headers = LinkedHashMap(headers),
      hardwareDecode = hardwareDecode,
      audioOutput = audioOutput.trim().lowercase(),
      bufferProfile = bufferProfile.trim().lowercase(),
    )
    activeSource = source
    startMedia(identity, source, announceLoading = true)
  }

  private fun startMedia(identity: Identity, source: PlaybackSource, announceLoading: Boolean) {
    if (!CharmStreamUrls.isHttpOrHttps(source.uri) && source.headers.isNotEmpty()) {
      // HTTP options do not configure RTSP/UDP/RTMP transports. LibVLC 3's
      // RTSP user agent is internal; do not silently ignore provider options.
      finishWithError(identity, "request-headers-unsupported")
      return
    }
    // LibVLC 3.7.5 has no arbitrary HTTP-header/cookie injection API. Passing
    // invented options silently loses provider authentication. Fail explicitly
    // before opening a connection instead of sending a different request.
    if (CharmStreamUrls.isHttpOrHttps(source.uri) && (
        source.headers.keys.any { it.lowercase() !in setOf("user-agent", "referer", "referrer") } ||
          !CharmHttpClients.cookieHeaderFor(source.uri).isNullOrEmpty()
      )) {
      finishWithError(identity, "request-headers-unsupported")
      return
    }
    try {
      val core = ensureCore() ?: throw IllegalStateException("LibVLC unavailable")
      val player = MediaPlayer(core)
      mediaPlayer = player
      player.volume = if (mutedState) 0 else 100
      player.setEventListener { event ->
        // LibVLC delivers events off the main thread. Emitting into React Native
        // from that thread is a documented hard crash on engine switch.
        when (event.type) {
          MediaPlayer.Event.Opening -> main.post { publishLoading(player, identity) }
          MediaPlayer.Event.Playing -> main.post { publishPlaying(player, identity) }
          MediaPlayer.Event.EncounteredError -> main.post { onPlaybackProblem(player, identity, "vlc-playback-error") }
          MediaPlayer.Event.EndReached -> main.post { onPlaybackProblem(player, identity, "stream-ended") }
          else -> Unit
        }
      }

      val host = surfaceFor(identity.owner)
      val attached = host != null && attachVideoLayout(identity.owner)
      if (announceLoading) {
        listener?.onState(identity, "loading", if (attached) null else "awaiting-surface")
      }
      val media = Media(core, Uri.parse(source.uri))
      media.setHWDecoderEnabled(source.hardwareDecode, false)
      val cachingMs = networkCachingMs(source.bufferProfile)
      media.addOption(":network-caching=$cachingMs")
      // Keep network and live caching aligned; VLC's own clock correction stays
      // enabled so audio and video cannot be forced onto independent clocks.
      media.addOption(":live-caching=$cachingMs")
      media.addOption(":http-reconnect")
      when (source.audioOutput) {
        "stereo" -> media.addOption(":stereo-mode=0")
        "passthrough" -> media.addOption(":spdif")
        else -> Unit
      }
      if (source.uri.startsWith("rtsp", ignoreCase = true)) {
        media.addOption(":rtsp-tcp")
      }
      source.headers.forEach { (key, value) ->
        when (key.lowercase()) {
          "user-agent" -> media.addOption(":http-user-agent=$value")
          "referer", "referrer" -> media.addOption(":http-referrer=$value")
        }
      }
      if (source.headers.keys.none { it.equals("User-Agent", ignoreCase = true) }) {
        media.addOption(":http-user-agent=TiviMate/5.1.6 (Linux; Android TV)")
      }
      player.media = media
      media.release()
      if (!attached) {
        // Decode without a measured TextureView = Onn black (+ often silent).
        // Wait for attachSurface / onSizeChanged to rebind and play.
        main.removeCallbacks(startupTimeout)
        main.postDelayed(startupTimeout, START_TIMEOUT_MS)
        return
      }
      player.play()
      main.removeCallbacks(startupTimeout)
      main.postDelayed(startupTimeout, START_TIMEOUT_MS)
    } catch (failure: Throwable) {
      Log.e(TAG, "VLC prepare failed", failure)
      if (recoverOnce(identity, "vlc-init-failed")) return
      finishWithError(identity, "vlc-init-failed")
    }
  }

  fun setResizeMode(mode: String?) = runOnMain {
    val normalized = mode?.trim()?.lowercase()
    resizeMode = when (normalized) {
      "fill", "zoom", "stretch" -> normalized
      else -> "fit"
    }
    mediaPlayer?.let { applyResizeMode(it) }
  }

  fun pause() = runOnMain { mediaPlayer?.pause() }

  fun resume() = runOnMain {
    if (owner != Owner.NONE) mediaPlayer?.play()
  }

  fun setMuted(muted: Boolean) = runOnMain {
    mutedState = muted
    mediaPlayer?.volume = if (muted) 0 else 100
  }

  fun selectAudio(trackId: Int) = runOnMain {
    mediaPlayer?.audioTrack = trackId
  }

  fun selectSubtitle(trackId: Int?) = runOnMain {
    mediaPlayer?.spuTrack = trackId ?: -1
  }

  fun stop(
    requestedOwner: Owner,
    releasePlayer: Boolean,
    onStopped: ((Throwable?) -> Unit)? = null,
  ) = runOnMain {
    if (owner == requestedOwner || pendingPrepare?.requestedOwner == requestedOwner || decoderReleaseFailure != null) {
      stopInternal(releasePlayer)
    }
    onStopped?.invoke(decoderReleaseFailure)
  }

  fun releaseAll() = runOnMain {
    pendingPrepare = null
    stopInternal(releasePlayer = true)
    previewSurface = null
    fullscreenSurface = null
    activity = null
  }

  private fun publishLoading(player: MediaPlayer, identity: Identity) {
    if (mediaPlayer !== player || activeIdentity != identity) return
    listener?.onState(identity, "loading", null)
  }

  private fun publishPlaying(player: MediaPlayer, identity: Identity) {
    if (mediaPlayer !== player || activeIdentity != identity) return
    playing = true
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    // Re-assert unmuted fullscreen volume in case a late preview mute raced in.
    if (identity.owner == Owner.FULLSCREEN && !mutedState) {
      try { player.volume = 100 } catch (_: Throwable) {}
    }
    listener?.onState(identity, "playing", null)
    publishTracks(player, identity)
  }

  private fun onPlaybackProblem(player: MediaPlayer, identity: Identity, reason: String) {
    if (mediaPlayer !== player || activeIdentity != identity) return
    playing = false
    main.removeCallbacks(startupTimeout)
    if (recoverOnce(identity, reason)) return
    finishWithError(identity, reason)
  }

  private fun recoverOnce(identity: Identity, reason: String): Boolean {
    if (activeIdentity != identity || owner == Owner.NONE) return false
    if (activeSource == null) return false
    if (recoveryAttempts >= MAX_ERROR_RECOVERIES) return false
    recoveryAttempts += 1
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    CharmMemoryCoordinator.setPlaybackStarting(true)
    listener?.onState(identity, "loading", "native-reprepare")
    Log.i(TAG, "VLC recovery $recoveryAttempts for $reason")
    main.postDelayed(delayedRecovery, ERROR_RECOVERY_DELAY_MS)
    return true
  }

  private fun performReconnect(identity: Identity, source: PlaybackSource) {
    if (activeIdentity != identity || owner == Owner.NONE) return
    if (!releasePlayerOnly(removeLayout = false)) {
      finishWithError(identity, "release-failed")
      return
    }
    playing = false
    startMedia(identity, source, announceLoading = false)
  }

  private fun finishWithError(identity: Identity, reason: String) {
    playing = false
    pendingPrepare = null
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    listener?.onState(identity, "error", reason)
    if (activeIdentity == identity) {
      if (!releasePlayerOnly(removeLayout = false)) return
      activeIdentity = null
      activeSource = null
      if (owner == identity.owner) owner = Owner.NONE
    }
  }

  private fun ensureCore(): LibVLC? {
    libVlc?.let { return it }
    val context = activity ?: return null
    return try {
      LibVLC(
        context.applicationContext,
        arrayListOf(
          "--audio-time-stretch",
          "--network-caching=5000",
          "--live-caching=5000",
        ),
      ).also { libVlc = it }
    } catch (failure: Throwable) {
      Log.e(TAG, "LibVLC init failed", failure)
      null
    }
  }

  // Small / Medium / Large live caching (ms).
  private fun networkCachingMs(profile: String): Int = when (profile) {
    "low_latency" -> 1_000
    "balanced" -> 3_000
    else -> 5_000
  }

  private fun surfaceFor(surfaceOwner: Owner): FrameLayout? = when (surfaceOwner) {
    Owner.PREVIEW -> previewSurface
    Owner.FULLSCREEN -> fullscreenSurface
    Owner.NONE -> null
  }

  private fun attachVideoLayout(surfaceOwner: Owner): Boolean {
    val surface = surfaceFor(surfaceOwner) ?: return false
    // Match Media3: attach when the host exists. Requiring width/height > 0
    // blocked play forever on Onn hosts that stay 0×0 until after first frame.
    val context = activity ?: return false
    unclipVideoAncestors(surface)
    val layout = videoLayout ?: VLCVideoLayout(context).also {
      it.clipChildren = false
      it.clipToPadding = false
      videoLayout = it
    }
    unclipVideoAncestors(layout)
    (layout.parent as? ViewGroup)?.removeView(layout)
    surface.removeAllViews()
    surface.addView(layout, FrameLayout.LayoutParams(-1, -1))
    layout.visibility = View.VISIBLE
    val player = mediaPlayer ?: return false
    try { player.detachViews() } catch (_: Throwable) {}
    return try {
      // TextureView for preview and fullscreen. SurfaceView on Onn Google TV
      // paints behind the React Native stack (audio continues, picture stays black).
      player.attachViews(layout, null, false, true)
      applyResizeMode(player)
      true
    } catch (failure: Throwable) {
      Log.w(TAG, "VLC attachViews failed", failure)
      false
    }
  }

  private fun applyResizeMode(player: MediaPlayer) {
    val scale = when (if (owner == Owner.FULLSCREEN) resizeMode else "fit") {
      // FIT_SCREEN preserves aspect ratio and crops only the overflow.
      "fill", "zoom" -> MediaPlayer.ScaleType.SURFACE_FIT_SCREEN
      // FILL uses the full host rectangle, intentionally changing aspect ratio.
      "stretch" -> MediaPlayer.ScaleType.SURFACE_FILL
      else -> MediaPlayer.ScaleType.SURFACE_BEST_FIT
    }
    try { player.setVideoScale(scale) } catch (_: Throwable) {}
  }

  private fun publishTracks(player: MediaPlayer, identity: Identity) {
    val audio = try {
      player.audioTracks?.map { TrackInfo(it.id, it.name ?: "Audio ${it.id}") } ?: emptyList()
    } catch (_: Throwable) {
      emptyList()
    }
    val subtitles = try {
      player.spuTracks
        ?.filter { it.id >= 0 }
        ?.map { TrackInfo(it.id, it.name ?: "Subtitle ${it.id}") }
        ?: emptyList()
    } catch (_: Throwable) {
      emptyList()
    }
    listener?.onTracks(identity, audio, subtitles)
  }

  private fun stopInternal(releasePlayer: Boolean) {
    val previousOwner = currentOwner()
    pendingPrepare = null
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    playing = false
    recoveryAttempts = 0
    CharmMemoryCoordinator.setPlaybackStarting(false)
    if (releasePlayer) {
      if (!releasePlayerOnly(removeLayout = true)) return
      try { libVlc?.release() } catch (failure: Throwable) {
        decoderReleaseFailure = failure
        owner = previousOwner
        return
      }
      libVlc = null
    } else {
      try { mediaPlayer?.stop() } catch (_: Throwable) {
        if (!releasePlayerOnly(removeLayout = true)) return
      }
      try { mediaPlayer?.detachViews() } catch (_: Throwable) {}
      videoLayout?.let { (it.parent as? ViewGroup)?.removeView(it) }
    }
    activeIdentity = null
    activeSource = null
    owner = Owner.NONE
  }

  private fun releasePlayerOnly(removeLayout: Boolean): Boolean {
    val player = mediaPlayer
    try { player?.stop() } catch (_: Throwable) {}
    try { player?.detachViews() } catch (_: Throwable) {}
    try { player?.release() } catch (failure: Throwable) {
      decoderReleaseFailure = failure
      return false
    }
    mediaPlayer = null
    decoderReleaseFailure = null
    if (removeLayout) {
      videoLayout?.let { (it.parent as? ViewGroup)?.removeView(it) }
      videoLayout = null
    }
    return true
  }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
