package com.charmiptv.app

import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout

/**
 * TiViMate-class LibVLC live engine.
 *
 * Default routing for opaque / MPEG-TS / RTSP-class streams selects VLC
 * (Settings can still force Media3). One MediaPlayer exists at a time and Media3
 * is fully released before a VLC tune starts. Opaque `/live/.../id` URLs rotate
 * `.ts` / `.m3u8` / `.mp4` suffixes on start-timeout like TiViMate-class clients.
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

  interface Listener {
    fun onState(identity: Identity, state: String, reason: String? = null)
    fun onTracks(identity: Identity, audio: List<TrackInfo>, subtitles: List<TrackInfo>)
  }

  private const val START_TIMEOUT_MS = 60_000L
  private const val OPAQUE_FIRST_URI_TIMEOUT_MS = 12_000L
  private const val MAX_AUTO_RECOVERIES = 4
  private val RECOVERY_BACKOFF_MS = longArrayOf(0L, 1_000L, 3_000L, 6_000L)
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
  private var listener: Listener? = null
  private var playing = false
  private var mutedState = false
  private var recoveryAttempts = 0
  private var uriLadder: List<String> = emptyList()
  private var uriLadderIndex = 0

  private val startupTimeout: Runnable = Runnable {
    val identity = activeIdentity ?: return@Runnable
    if (playing || owner == Owner.NONE) return@Runnable
    if (advanceUriLadder(identity, "start-timeout")) return@Runnable
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

  fun currentOwner(): Owner = owner

  fun attachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface = surface
      Owner.FULLSCREEN -> fullscreenSurface = surface
      Owner.NONE -> return@runOnMain
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
      listener?.onState(Identity(requestedOwner, nextGeneration, nextChannelKey.trim()), "error", "owner-reserved")
      return@runOnMain
    }

    NativePlaybackManager.stopForEngineSwitch()
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    releasePlayerOnly(removeLayout = false)

    owner = requestedOwner
    playing = false
    recoveryAttempts = 0
    uriLadder = CharmStreamUrls.opaqueUriVariants(uri)
    uriLadderIndex = 0
    CharmMemoryCoordinator.setPlaybackStarting(true)
    val identity = Identity(requestedOwner, nextGeneration, nextChannelKey.trim())
    activeIdentity = identity
    val source = PlaybackSource(
      uri = uriLadder.first(),
      headers = LinkedHashMap(headers),
      hardwareDecode = hardwareDecode,
      audioOutput = audioOutput.trim().lowercase(),
      bufferProfile = bufferProfile.trim().lowercase(),
    )
    activeSource = source
    startMedia(identity, source, announceLoading = true)
  }

  private fun startMedia(identity: Identity, source: PlaybackSource, announceLoading: Boolean) {
    try {
      val core = ensureCore() ?: throw IllegalStateException("LibVLC unavailable")
      val player = MediaPlayer(core)
      mediaPlayer = player
      player.volume = if (mutedState) 0 else 100
      configureAudioOutput(player, source.audioOutput)
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

      attachVideoLayout(identity.owner)
      if (announceLoading) listener?.onState(identity, "loading", null)
      val media = Media(core, Uri.parse(source.uri))
      media.setHWDecoderEnabled(source.hardwareDecode, false)
      media.addOption(":network-caching=${networkCachingMs(source.bufferProfile)}")
      media.addOption(":http-reconnect")
      source.headers.forEach { (key, value) ->
        when (key.lowercase()) {
          "user-agent" -> media.addOption(":http-user-agent=$value")
          "referer", "referrer" -> media.addOption(":http-referrer=$value")
          "cookie" -> media.addOption(":http-cookie=$value")
          else -> media.addOption(":http-header=$key: $value")
        }
      }
      if (source.headers.keys.none { it.equals("User-Agent", ignoreCase = true) }) {
        media.addOption(":http-user-agent=TiviMate/5.1.6 (Linux; Android TV)")
      }
      if (source.headers.keys.none { it.equals("Accept", ignoreCase = true) }) {
        media.addOption(":http-header=Accept: */*")
      }
      if (source.headers.keys.none { it.equals("Cookie", ignoreCase = true) }) {
        CharmHttpClients.cookieHeaderFor(source.uri)?.let { media.addOption(":http-cookie=$it") }
      }
      player.media = media
      media.release()
      player.play()
      main.removeCallbacks(startupTimeout)
      val firstOpaque = uriLadder.size > 1 && uriLadderIndex == 0
      main.postDelayed(startupTimeout, if (firstOpaque) OPAQUE_FIRST_URI_TIMEOUT_MS else START_TIMEOUT_MS)
    } catch (failure: Throwable) {
      Log.e(TAG, "VLC prepare failed", failure)
      if (advanceUriLadder(identity, "vlc-init-failed")) return
      if (recoverOnce(identity, "vlc-init-failed")) return
      finishWithError(identity, "vlc-init-failed")
    }
  }

  fun setResizeMode(mode: String?) = runOnMain {
    if (mode == "fit" || mode.isNullOrBlank()) {
      try { mediaPlayer?.setAspectRatio(null) } catch (_: Throwable) {}
      try { mediaPlayer?.setScale(0f) } catch (_: Throwable) {}
    }
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
    onStopped: (() -> Unit)? = null,
  ) = runOnMain {
    if (owner == requestedOwner) stopInternal(releasePlayer)
    onStopped?.invoke()
  }

  fun stopForEngineSwitch() = runOnMain { stopInternal(releasePlayer = true) }

  fun releaseAll() = runOnMain {
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
    recoveryAttempts = 0
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    listener?.onState(identity, "playing", null)
    publishTracks(player, identity)
  }

  private fun onPlaybackProblem(player: MediaPlayer, identity: Identity, reason: String) {
    if (mediaPlayer !== player || activeIdentity != identity) return
    playing = false
    main.removeCallbacks(startupTimeout)
    if (advanceUriLadder(identity, reason)) return
    if (recoverOnce(identity, reason)) return
    finishWithError(identity, reason)
  }

  private fun advanceUriLadder(identity: Identity, reason: String): Boolean {
    if (activeIdentity != identity || owner == Owner.NONE) return false
    val source = activeSource ?: return false
    if (uriLadderIndex + 1 >= uriLadder.size) return false
    uriLadderIndex += 1
    val nextUri = uriLadder[uriLadderIndex]
    val next = source.copy(uri = nextUri)
    activeSource = next
    recoveryAttempts = 0
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    releasePlayerOnly(removeLayout = false)
    playing = false
    CharmMemoryCoordinator.setPlaybackStarting(true)
    Log.i(TAG, "VLC URI ladder $uriLadderIndex/${uriLadder.size} after $reason → $nextUri")
    listener?.onState(identity, "loading", "native-reprepare")
    startMedia(identity, next, announceLoading = false)
    return true
  }

  private fun recoverOnce(identity: Identity, reason: String): Boolean {
    if (activeIdentity != identity || owner == Owner.NONE) return false
    val source = activeSource ?: return false
    if (recoveryAttempts >= MAX_AUTO_RECOVERIES) return false
    val delayMs = RECOVERY_BACKOFF_MS.getOrElse(recoveryAttempts) { 6_000L }
    recoveryAttempts += 1
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    CharmMemoryCoordinator.setPlaybackStarting(true)
    listener?.onState(identity, "loading", "native-reprepare")
    Log.i(TAG, "VLC recovery $recoveryAttempts for $reason")
    if (delayMs == 0L) {
      performReconnect(identity, source)
    } else {
      main.postDelayed(delayedRecovery, delayMs)
    }
    return true
  }

  private fun performReconnect(identity: Identity, source: PlaybackSource) {
    if (activeIdentity != identity || owner == Owner.NONE) return
    releasePlayerOnly(removeLayout = false)
    playing = false
    startMedia(identity, source, announceLoading = false)
  }

  private fun finishWithError(identity: Identity, reason: String) {
    playing = false
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    listener?.onState(identity, "error", reason)
    if (activeIdentity == identity) {
      releasePlayerOnly(removeLayout = false)
      activeIdentity = null
      activeSource = null
      if (owner == identity.owner) owner = Owner.NONE
    }
  }

  private fun publishFailure(player: MediaPlayer, identity: Identity, reason: String) {
    if (mediaPlayer !== player || activeIdentity != identity) return
    finishWithError(identity, reason)
  }

  private fun ensureCore(): LibVLC? {
    libVlc?.let { return it }
    val context = activity ?: return null
    return try {
      LibVLC(
        context.applicationContext,
        arrayListOf("--audio-time-stretch"),
      ).also { libVlc = it }
    } catch (failure: Throwable) {
      Log.e(TAG, "LibVLC init failed", failure)
      null
    }
  }

  private fun configureAudioOutput(player: MediaPlayer, audioOutput: String) {
    try {
      when (audioOutput) {
        "stereo" -> player.setAudioOutputDevice("stereo")
        "passthrough" -> player.setAudioOutputDevice("encoded")
        else -> Unit
      }
    } catch (_: Throwable) {
      // Some OEM audio stacks reject explicit devices. VLC's default remains usable.
    }
  }

  // TiViMate buffer size mapping: Small / Medium / Large (ms).
  // Large mirrors Media3's Onn-proven min-buffer class (20s).
  private fun networkCachingMs(profile: String): Int = when (profile) {
    "low_latency" -> 2_000
    "balanced" -> 5_000
    else -> 20_000
  }

  private fun attachVideoLayout(surfaceOwner: Owner): Boolean {
    val surface = when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    } ?: return false
    val context = activity ?: return false
    val layout = videoLayout ?: VLCVideoLayout(context).also {
      it.clipChildren = false
      it.clipToPadding = false
      videoLayout = it
    }
    (layout.parent as? ViewGroup)?.removeView(layout)
    surface.removeAllViews()
    surface.addView(layout, FrameLayout.LayoutParams(-1, -1))
    val player = mediaPlayer ?: return false
    try { player.detachViews() } catch (_: Throwable) {}
    return try {
      // TextureView for preview and fullscreen. SurfaceView on Onn Google TV
      // paints behind the React Native stack (audio continues, picture stays black).
      player.attachViews(layout, null, false, true)
      true
    } catch (failure: Throwable) {
      Log.w(TAG, "VLC attachViews failed", failure)
      false
    }
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
    main.removeCallbacks(startupTimeout)
    main.removeCallbacks(delayedRecovery)
    playing = false
    recoveryAttempts = 0
    activeIdentity = null
    activeSource = null
    owner = Owner.NONE
    CharmMemoryCoordinator.setPlaybackStarting(false)
    if (releasePlayer) {
      releasePlayerOnly(removeLayout = true)
      try { libVlc?.release() } catch (_: Throwable) {}
      libVlc = null
    } else {
      try { mediaPlayer?.stop() } catch (_: Throwable) {}
      try { mediaPlayer?.detachViews() } catch (_: Throwable) {}
      videoLayout?.let { (it.parent as? ViewGroup)?.removeView(it) }
    }
  }

  private fun releasePlayerOnly(removeLayout: Boolean) {
    val player = mediaPlayer
    mediaPlayer = null
    try { player?.stop() } catch (_: Throwable) {}
    try { player?.detachViews() } catch (_: Throwable) {}
    try { player?.release() } catch (_: Throwable) {}
    if (removeLayout) {
      videoLayout?.let { (it.parent as? ViewGroup)?.removeView(it) }
      videoLayout = null
    }
  }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
