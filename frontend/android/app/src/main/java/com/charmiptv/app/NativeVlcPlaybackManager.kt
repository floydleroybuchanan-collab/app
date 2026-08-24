package com.charmiptv.app

import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
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
 * at a time and the Media3 player is fully released before a VLC tune starts.
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

  private const val START_TIMEOUT_MS = 20_000L

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

  private val startupTimeout = Runnable {
    val identity = activeIdentity ?: return@Runnable
    if (playing || owner == Owner.NONE) return@Runnable
    CharmMemoryCoordinator.setPlaybackStarting(false)
    listener?.onState(identity, "error", "start-timeout")
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
    if (owner == surfaceOwner) attachVideoLayout(surfaceOwner)
  }

  fun detachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    val attached = when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    }
    if (attached !== surface) return@runOnMain
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
    if (requestedOwner == Owner.PREVIEW && owner == Owner.FULLSCREEN) return@runOnMain

    // A manual engine switch must never leave two native decoders alive. Use
    // stopForEngineSwitch(), not releaseAll(): releaseAll() also nulls Media3's
    // listener/activity/surface refs, and NativePlaybackModule's listener is
    // only ever registered once at NativeModule construction — that
    // permanently silenced every Media3 state/track/diagnostic callback to JS
    // after the first switch away from it (looked like "Media3 broken after
    // using VLC").
    NativePlaybackManager.stopForEngineSwitch()
    main.removeCallbacks(startupTimeout)
    releasePlayerOnly(removeLayout = false)

    owner = requestedOwner
    playing = false
    // Media3's manager holds off background/moderate memory trims for a grace
    // window around decoder startup (CharmMemoryCoordinator.setPlaybackStarting).
    // VLC never told the coordinator it was starting at all, so a trim could
    // land mid-tune here — competing with LibVLC's own core/decoder/surface
    // setup for the same RAM right when it's least able to absorb it. Cleared
    // on Playing/error/end/timeout below and in stopInternal.
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

    val core = ensureCore()
    val player = MediaPlayer(core)
    mediaPlayer = player
    configureAudioOutput(player, source.audioOutput)
    player.setEventListener { event ->
      if (mediaPlayer !== player || activeIdentity != identity) return@setEventListener
      when (event.type) {
        MediaPlayer.Event.Opening,
        MediaPlayer.Event.Buffering -> listener?.onState(identity, "loading", null)
        MediaPlayer.Event.Playing -> {
          playing = true
          main.removeCallbacks(startupTimeout)
          CharmMemoryCoordinator.setPlaybackStarting(false)
          listener?.onState(identity, "playing", null)
          publishTracks(player, identity)
        }
        MediaPlayer.Event.EncounteredError -> {
          playing = false
          main.removeCallbacks(startupTimeout)
          CharmMemoryCoordinator.setPlaybackStarting(false)
          // Release the failed player instead of leaving it parked until the
          // next tune happens to reuse or replace it. Deferred via post(), not
          // called inline — this branch runs from inside player's own
          // setEventListener callback, and releasing a LibVLC MediaPlayer from
          // inside its own native event dispatch is unsafe.
          main.post { if (mediaPlayer === player) releasePlayerOnly(removeLayout = false) }
          listener?.onState(identity, "error", "vlc-playback-error")
        }
        MediaPlayer.Event.EndReached -> {
          playing = false
          main.removeCallbacks(startupTimeout)
          CharmMemoryCoordinator.setPlaybackStarting(false)
          main.post { if (mediaPlayer === player) releasePlayerOnly(removeLayout = false) }
          listener?.onState(identity, "error", "stream-ended")
        }
      }
    }

    if (!attachVideoLayout(requestedOwner)) {
      listener?.onState(identity, "error", "surface-unavailable")
      return@runOnMain
    }

    listener?.onState(identity, "loading", null)
    val media = Media(core, Uri.parse(source.uri))
    media.setHWDecoderEnabled(source.hardwareDecode, false)
    media.addOption(":network-caching=${networkCachingMs(source.bufferProfile)}")
    // LibVLC 3's Android HTTP access exposes provider UA and referrer knobs.
    // Other custom headers stay on Media3; do not pretend VLC can forward them.
    source.headers.forEach { (key, value) ->
      when (key.lowercase()) {
        "user-agent" -> media.addOption(":http-user-agent=$value")
        "referer", "referrer" -> media.addOption(":http-referrer=$value")
      }
    }
    player.media = media
    media.release()
    player.play()
    main.postDelayed(startupTimeout, START_TIMEOUT_MS)
  }

  fun setResizeMode(mode: String?) = runOnMain {
    // VLCVideoLayout handles the normal fit path itself. Preserve that stable
    // behavior here rather than applying a fake crop/stretch transform.
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

  /**
   * Stop and release the LibVLC core/player when the user switches to a
   * different playback engine. Deliberately does NOT clear listener/activity/
   * surface references the way releaseAll() does — those stay valid for the
   * app's lifetime and are needed again the instant the user switches back to
   * VLC. See the matching NativePlaybackManager.stopForEngineSwitch() doc.
   */
  fun stopForEngineSwitch() = runOnMain { stopInternal(releasePlayer = true) }

  fun releaseAll() = runOnMain {
    stopInternal(releasePlayer = true)
    previewSurface = null
    fullscreenSurface = null
    activity = null
  }

  private fun ensureCore(): LibVLC {
    libVlc?.let { return it }
    val context = activity ?: error("Activity unavailable")
    return LibVLC(context.applicationContext, arrayListOf()).also { libVlc = it }
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

  private fun networkCachingMs(profile: String): Int = when (profile) {
    "low_latency" -> 1_000
    "balanced" -> 1_500
    else -> 3_000
  }

  private fun attachVideoLayout(surfaceOwner: Owner): Boolean {
    val surface = when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    } ?: return false
    val context = activity ?: return false
    val layout = videoLayout ?: VLCVideoLayout(context).also { videoLayout = it }
    (layout.parent as? ViewGroup)?.removeView(layout)
    surface.removeAllViews()
    surface.addView(layout, FrameLayout.LayoutParams(-1, -1))
    val player = mediaPlayer ?: return false
    try { player.detachViews() } catch (_: Throwable) {}
    // Every other native/JNI call on this MediaPlayer is guarded the same way
    // (see stopInternal/releasePlayerOnly below) — attachViews() was the one
    // exception, and an uncaught throw here on the main thread crashes the
    // whole app rather than just failing this one tune. libVLC's Android
    // JNI layer can throw (or the core can already be mid-release from a
    // fast preview<->fullscreen or Media3<->VLC switch) even though this is
    // the normal, expected path.
    try {
      player.attachViews(layout, null, false, false)
    } catch (_: Throwable) {
      return false
    }
    return true
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
