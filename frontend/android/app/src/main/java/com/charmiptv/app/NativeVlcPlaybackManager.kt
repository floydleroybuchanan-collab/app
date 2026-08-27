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
 * Manual LibVLC compatibility engine.
 *
 * This manager never chooses itself automatically. StreamPlayer selects it only
 * when the user has explicitly selected VLC in Settings. One MediaPlayer exists
 * at a time and Media3 is fully released before a VLC tune starts. A temporary
 * React/Fabric surface loss pauses and detaches only the video target; it never
 * leaves audio running against a missing layout and never creates a second
 * decoder to recover the display.
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
  private var listener: Listener? = null
  private var playing = false
  private var mutedState = false

  private val startupTimeout = Runnable {
    val identity = activeIdentity ?: return@Runnable
    if (playing || owner == Owner.NONE) return@Runnable
    CharmMemoryCoordinator.setPlaybackStarting(false)
    listener?.onState(identity, "error", "start-timeout")
    main.post {
      if (activeIdentity == identity) {
        releasePlayerOnly(removeLayout = false)
        activeIdentity = null
        owner = Owner.NONE
      }
    }
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
    releasePlayerOnly(removeLayout = false)

    owner = requestedOwner
    playing = false
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
          MediaPlayer.Event.EncounteredError -> main.post { publishFailure(player, identity, "vlc-playback-error") }
          MediaPlayer.Event.EndReached -> main.post { publishFailure(player, identity, "stream-ended") }
          else -> Unit
        }
      }

      attachVideoLayout(requestedOwner)
      listener?.onState(identity, "loading", null)
      val media = Media(core, Uri.parse(source.uri))
      media.setHWDecoderEnabled(source.hardwareDecode, false)
      media.addOption(":network-caching=${networkCachingMs(source.bufferProfile)}")
      source.headers.forEach { (key, value) ->
        when (key.lowercase()) {
          "user-agent" -> media.addOption(":http-user-agent=$value")
          "referer", "referrer" -> media.addOption(":http-referrer=$value")
        }
      }
      if (source.headers.keys.none { it.equals("User-Agent", ignoreCase = true) }) {
        media.addOption(":http-user-agent=CharmIPTV/Experimental-v3")
      }
      player.media = media
      media.release()
      player.play()
      main.postDelayed(startupTimeout, START_TIMEOUT_MS)
    } catch (failure: Throwable) {
      Log.e(TAG, "VLC prepare failed", failure)
      CharmMemoryCoordinator.setPlaybackStarting(false)
      listener?.onState(identity, "error", "vlc-init-failed")
      releasePlayerOnly(removeLayout = false)
      activeIdentity = null
      owner = Owner.NONE
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
    main.removeCallbacks(startupTimeout)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    listener?.onState(identity, "playing", null)
    publishTracks(player, identity)
  }

  private fun publishFailure(player: MediaPlayer, identity: Identity, reason: String) {
    if (mediaPlayer !== player || activeIdentity != identity) return
    playing = false
    main.removeCallbacks(startupTimeout)
    CharmMemoryCoordinator.setPlaybackStarting(false)
    listener?.onState(identity, "error", reason)
    if (mediaPlayer === player && activeIdentity == identity) {
      releasePlayerOnly(removeLayout = false)
      activeIdentity = null
      if (owner == identity.owner) owner = Owner.NONE
    }
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
    playing = false
    activeIdentity = null
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
