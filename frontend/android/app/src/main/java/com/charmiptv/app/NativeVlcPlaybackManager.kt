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
 * Manual compatibility engine. This manager never auto-falls back from Media3
 * and never owns more than one LibVLC MediaPlayer. JS releases the opposite
 * engine before prepare() so Media3 and VLC cannot decode the same stream at once.
 */
object NativeVlcPlaybackManager {
  enum class Owner { NONE, PREVIEW, FULLSCREEN }

  data class Identity(val owner: Owner, val generation: Long, val channelKey: String)
  data class TrackInfo(val id: Int, val label: String)

  interface Listener {
    fun onState(identity: Identity, state: String, reason: String? = null)
    fun onTracks(identity: Identity, audio: List<TrackInfo>, subtitles: List<TrackInfo>)
  }

  private data class PlaybackSource(
    val identity: Identity,
    val uri: String,
    val headers: Map<String, String>,
    val hardwareDecode: Boolean,
    val audioOutput: String,
    val bufferProfile: String,
  )

  private val main = Handler(Looper.getMainLooper())
  private var activity: Activity? = null
  private var previewSurface: FrameLayout? = null
  private var fullscreenSurface: FrameLayout? = null
  private var videoLayout: VLCVideoLayout? = null
  private var libVlc: LibVLC? = null
  private var player: MediaPlayer? = null
  private var listener: Listener? = null
  private var owner = Owner.NONE
  private var activeSource: PlaybackSource? = null
  private var muted = false
  private var resizeMode = "fit"
  private var libVlcConfigKey = ""

  fun setListener(next: Listener?) = runOnMain { listener = next }

  fun installIntoActivity(next: Activity) = runOnMain {
    if (activity !== next) {
      activity = next
      if (videoLayout != null && videoLayout?.context !== next) {
        releaseAllInternal(clearActivity = false)
        activity = next
      }
    }
  }

  fun currentOwner(): Owner = owner

  fun attachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface = surface
      Owner.FULLSCREEN -> fullscreenSurface = surface
      Owner.NONE -> return@runOnMain
    }
    if (owner == surfaceOwner && player != null) attachVideoLayout(surfaceOwner)
  }

  fun detachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    val attached = when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    }
    if (attached !== surface) return@runOnMain
    if (owner == surfaceOwner) {
      try { player?.detachViews() } catch (_: Throwable) {}
      videoLayout?.let { layout -> if (layout.parent === surface) surface.removeView(layout) }
    }
    when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface = null
      Owner.FULLSCREEN -> fullscreenSurface = null
      Owner.NONE -> Unit
    }
  }

  fun prepare(
    requestedOwner: Owner,
    generation: Long,
    channelKey: String,
    uri: String,
    headers: Map<String, String>,
    hardwareDecode: Boolean,
    audioOutput: String,
    bufferProfile: String,
  ) = runOnMain {
    if (requestedOwner == Owner.PREVIEW && owner == Owner.FULLSCREEN) return@runOnMain
    val host = activity ?: run {
      listener?.onState(Identity(requestedOwner, generation, channelKey), "error", "activity-unavailable")
      return@runOnMain
    }
    val cleanUri = uri.trim()
    if (cleanUri.isEmpty()) {
      listener?.onState(Identity(requestedOwner, generation, channelKey), "error", "empty-uri")
      return@runOnMain
    }

    val identity = Identity(requestedOwner, generation, channelKey.trim())
    val source = PlaybackSource(
      identity = identity,
      uri = cleanUri,
      headers = LinkedHashMap(headers),
      hardwareDecode = hardwareDecode,
      audioOutput = normalizeAudioOutput(audioOutput),
      bufferProfile = normalizeBufferProfile(bufferProfile),
    )

    owner = requestedOwner
    activeSource = source
    try {
      ensureLibVlc(host, source.audioOutput)
      // A new MediaPlayer per tune gives callbacks an immutable generation/channel
      // identity and guarantees the prior decoder is released before the new one.
      releasePlayerOnly(removeLayout = false)
      val core = libVlc ?: throw IllegalStateException("LibVLC unavailable")
      val instance = MediaPlayer(core)
      player = instance
      instance.setEventListener { event -> handlePlayerEvent(identity, event) }
      if (!attachVideoLayout(requestedOwner)) {
        finishWithError(identity, "surface-unavailable")
        return@runOnMain
      }
      applyResizeMode(instance)
      instance.volume = if (muted) 0 else 100

      val media = Media(core, Uri.parse(source.uri))
      try {
        media.setHWDecoderEnabled(source.hardwareDecode, false)
        addMediaOptions(media, source)
        instance.media = media
      } finally {
        media.release()
      }
      listener?.onState(identity, "loading", null)
      if (!instance.play()) finishWithError(identity, "vlc-play-failed")
    } catch (error: Throwable) {
      finishWithError(identity, "vlc-${error.javaClass.simpleName}")
    }
  }

  fun pause() = runOnMain {
    try { player?.pause() } catch (_: Throwable) {}
  }

  fun resume() = runOnMain {
    if (owner == Owner.NONE) return@runOnMain
    try { player?.play() } catch (_: Throwable) {}
  }

  fun setMuted(next: Boolean) = runOnMain {
    muted = next
    try { player?.volume = if (next) 0 else 100 } catch (_: Throwable) {}
  }

  fun setResizeMode(mode: String?) = runOnMain {
    resizeMode = when (mode) { "zoom" -> "zoom"; "stretch" -> "stretch"; else -> "fit" }
    player?.let(::applyResizeMode)
  }

  fun selectAudio(trackId: Int) = runOnMain {
    try { player?.setAudioTrack(trackId) } catch (_: Throwable) {}
  }

  fun selectSubtitle(trackId: Int?) = runOnMain {
    try { player?.setSpuTrack(trackId ?: -1) } catch (_: Throwable) {}
  }

  fun stop(requestedOwner: Owner, releasePlayer: Boolean = false, onStopped: (() -> Unit)? = null) = runOnMain {
    if (owner != requestedOwner) {
      onStopped?.invoke()
      return@runOnMain
    }
    stopInternal(releasePlayer)
    onStopped?.invoke()
  }

  fun suspendForBackground() = runOnMain { releaseAllInternal(clearActivity = false) }
  fun releaseAll() = runOnMain { releaseAllInternal(clearActivity = true) }

  private fun ensureLibVlc(host: Activity, audioOutput: String) {
    val configKey = audioOutput
    if (libVlc != null && libVlcConfigKey == configKey) return
    releasePlayerOnly(removeLayout = false)
    try { libVlc?.release() } catch (_: Throwable) {}
    val options = arrayListOf(
      "--no-video-title-show",
      "--clock-jitter=0",
      "--clock-synchro=0",
    )
    when (audioOutput) {
      "stereo" -> options.add("--stereo-mode=1")
      "passthrough" -> {
        options.add("--aout=android_audiotrack")
        options.add("--audio-digital-hdmi-passthrough")
      }
    }
    libVlc = LibVLC(host.applicationContext, options)
    libVlcConfigKey = configKey
  }

  private fun addMediaOptions(media: Media, source: PlaybackSource) {
    val fullMs = when (source.bufferProfile) {
      "low_latency" -> 900
      "stable" -> 3200
      else -> 1800
    }
    val networkCaching = if (source.identity.owner == Owner.PREVIEW) 1000 else fullMs
    val liveCaching = networkCaching
    val fileCaching = if (source.identity.owner == Owner.PREVIEW) 700 else (fullMs * 0.62).toInt()
    media.addOption(":network-caching=$networkCaching")
    media.addOption(":live-caching=$liveCaching")
    media.addOption(":file-caching=$fileCaching")
    media.addOption(":http-reconnect")

    val userAgent = header(source.headers, "User-Agent")
    val referer = header(source.headers, "Referer")
    if (!userAgent.isNullOrBlank()) media.addOption(":http-user-agent=${safeOptionValue(userAgent)}")
    if (!referer.isNullOrBlank()) media.addOption(":http-referrer=${safeOptionValue(referer)}")

    for ((rawKey, rawValue) in source.headers) {
      if (rawKey.equals("User-Agent", true) || rawKey.equals("Referer", true)) continue
      val key = safeHeaderToken(rawKey)
      val value = safeOptionValue(rawValue)
      if (key.isNotEmpty() && value.isNotEmpty()) media.addOption(":http-header=$key: $value")
    }
  }

  private fun attachVideoLayout(surfaceOwner: Owner): Boolean {
    val host = activity ?: return false
    val target = when (surfaceOwner) {
      Owner.PREVIEW -> previewSurface
      Owner.FULLSCREEN -> fullscreenSurface
      Owner.NONE -> null
    } ?: return false
    val layout = videoLayout ?: VLCVideoLayout(host).also {
      it.layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      videoLayout = it
    }
    (layout.parent as? ViewGroup)?.let { parent -> if (parent !== target) parent.removeView(layout) }
    if (layout.parent == null) target.addView(layout, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    val instance = player ?: return false
    try { instance.detachViews() } catch (_: Throwable) {}
    return try {
      // TextureView keeps preview/fullscreen reparenting deterministic on Android TV.
      instance.attachViews(layout, null, true, true)
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun applyResizeMode(instance: MediaPlayer) {
    try {
      instance.setVideoScale(
        when (resizeMode) {
          "zoom" -> MediaPlayer.ScaleType.SURFACE_FIT_SCREEN
          "stretch" -> MediaPlayer.ScaleType.SURFACE_FILL
          else -> MediaPlayer.ScaleType.SURFACE_BEST_FIT
        }
      )
    } catch (_: Throwable) {}
  }

  private fun handlePlayerEvent(identity: Identity, event: MediaPlayer.Event) {
    runOnMain {
      // The listener closure belongs to the MediaPlayer created for this identity.
      // Old callbacks are ignored after channel/engine replacement.
      if (activeSource?.identity != identity || owner != identity.owner) return@runOnMain
      when (event.type) {
        MediaPlayer.Event.Opening -> listener?.onState(identity, "loading", null)
        MediaPlayer.Event.Buffering -> {
          if (event.buffering < 100f) listener?.onState(identity, "loading", null)
        }
        MediaPlayer.Event.Playing -> {
          listener?.onState(identity, "playing", null)
          publishTracks(identity)
        }
        MediaPlayer.Event.EncounteredError -> finishWithError(identity, "vlc-stream-error")
        MediaPlayer.Event.EndReached -> finishWithError(identity, "vlc-end-reached")
      }
    }
  }

  private fun publishTracks(identity: Identity) {
    val instance = player ?: return
    val audio = try {
      instance.audioTracks?.filter { it.id >= 0 }?.map { TrackInfo(it.id, it.name ?: "Audio ${it.id}") } ?: emptyList()
    } catch (_: Throwable) { emptyList() }
    val text = try {
      instance.spuTracks?.filter { it.id >= 0 }?.map { TrackInfo(it.id, it.name ?: "CC ${it.id}") } ?: emptyList()
    } catch (_: Throwable) { emptyList() }
    listener?.onTracks(identity, audio, text)
  }

  private fun finishWithError(identity: Identity, reason: String) {
    if (activeSource?.identity == identity) listener?.onState(identity, "error", reason)
  }

  private fun stopInternal(releaseEngine: Boolean) {
    releasePlayerOnly(removeLayout = true)
    activeSource = null
    owner = Owner.NONE
    if (releaseEngine) {
      try { libVlc?.release() } catch (_: Throwable) {}
      libVlc = null
      libVlcConfigKey = ""
      videoLayout = null
    }
  }

  private fun releasePlayerOnly(removeLayout: Boolean) {
    val instance = player
    player = null
    if (instance != null) {
      try { instance.setEventListener(null) } catch (_: Throwable) {}
      try { instance.stop() } catch (_: Throwable) {}
      try { instance.detachViews() } catch (_: Throwable) {}
      try { instance.release() } catch (_: Throwable) {}
    }
    if (removeLayout) {
      videoLayout?.let { layout -> (layout.parent as? ViewGroup)?.removeView(layout) }
    }
  }

  private fun releaseAllInternal(clearActivity: Boolean) {
    releasePlayerOnly(removeLayout = true)
    try { libVlc?.release() } catch (_: Throwable) {}
    libVlc = null
    libVlcConfigKey = ""
    videoLayout = null
    activeSource = null
    owner = Owner.NONE
    if (clearActivity) {
      previewSurface = null
      fullscreenSurface = null
      activity = null
    }
  }

  private fun normalizeAudioOutput(value: String?): String = when (value) {
    "stereo" -> "stereo"
    "passthrough" -> "passthrough"
    else -> "auto"
  }

  private fun normalizeBufferProfile(value: String?): String = when (value) {
    "low_latency" -> "low_latency"
    "stable" -> "stable"
    else -> "balanced"
  }

  private fun header(headers: Map<String, String>, name: String): String? =
    headers.entries.firstOrNull { it.key.equals(name, true) }?.value

  private fun safeHeaderToken(value: String): String = value.trim().filter { it.isLetterOrDigit() || it == '-' }.take(64)
  private fun safeOptionValue(value: String): String = value.replace('\r', ' ').replace('\n', ' ').trim().take(2048)

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
