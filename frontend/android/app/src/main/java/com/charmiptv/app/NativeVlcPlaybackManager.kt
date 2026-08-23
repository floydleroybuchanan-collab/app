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

object NativeVlcPlaybackManager {
  enum class Owner { NONE, PREVIEW, FULLSCREEN }
  data class AudioTrackInfo(val id: Int, val label: String)
  data class SubtitleTrackInfo(val id: Int, val label: String)
  interface Listener {
    fun onState(state: String, reason: String?, owner: Owner, generation: Long, channelKey: String)
    fun onTracks(audio: List<AudioTrackInfo>, subtitles: List<SubtitleTrackInfo>, owner: Owner, generation: Long, channelKey: String)
  }
  private val main = Handler(Looper.getMainLooper())
  private var activity: Activity? = null
  private var libVlc: LibVLC? = null
  private var mediaPlayer: MediaPlayer? = null
  private var videoLayout: VLCVideoLayout? = null
  private var previewSurface: FrameLayout? = null
  private var fullscreenSurface: FrameLayout? = null
  private var owner = Owner.NONE
  private var listener: Listener? = null
  private var generation = 0L
  private var channelKey = ""
  fun installIntoActivity(next: Activity) = runOnMain { activity = next }
  fun setListener(next: Listener?) = runOnMain { listener = next }
  fun attachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    when (surfaceOwner) { Owner.PREVIEW -> previewSurface = surface; Owner.FULLSCREEN -> fullscreenSurface = surface; Owner.NONE -> return@runOnMain }
    if (owner == surfaceOwner) attachVideoLayout(surfaceOwner)
  }
  fun detachSurface(surfaceOwner: Owner, surface: FrameLayout) = runOnMain {
    val attached = when (surfaceOwner) { Owner.PREVIEW -> previewSurface; Owner.FULLSCREEN -> fullscreenSurface; Owner.NONE -> null }
    if (attached !== surface) return@runOnMain
    if (videoLayout?.parent === surface) surface.removeView(videoLayout)
    when (surfaceOwner) { Owner.PREVIEW -> previewSurface = null; Owner.FULLSCREEN -> fullscreenSurface = null; Owner.NONE -> Unit }
  }
  fun prepare(requestedOwner: Owner, nextGeneration: Long, nextChannelKey: String, uri: String, headers: Map<String, String>, hardwareDecode: Boolean, audioOutput: String, bufferProfile: String) = runOnMain {
    if (requestedOwner == Owner.PREVIEW && owner == Owner.FULLSCREEN) return@runOnMain
    NativePlaybackManager.releaseAll()
    stopInternal(false)
    owner = requestedOwner; generation = nextGeneration; channelKey = nextChannelKey
    val player = ensurePlayer(audioOutput)
    if (!attachVideoLayout(requestedOwner)) { listener?.onState("error", "surface-unavailable", owner, generation, channelKey); return@runOnMain }
    listener?.onState("loading", null, owner, generation, channelKey)
    val vlc = libVlc ?: return@runOnMain
    val cachingMs = if (bufferProfile.lowercase().contains("low")) 1000 else 1500
    val media = Media(vlc, Uri.parse(uri)).apply {
      setHWDecoderEnabled(hardwareDecode, false)
      addOption(":network-caching=$cachingMs")
      headers.forEach { (key, value) -> when (key.lowercase()) { "user-agent" -> addOption(":http-user-agent=$value"); "referer", "referrer" -> addOption(":http-referrer=$value") } }
    }
    player.media = media; media.release(); player.play()
  }
  fun setResizeMode(mode: String?) = Unit
  fun pause() = runOnMain { mediaPlayer?.pause() }
  fun resume() = runOnMain { mediaPlayer?.play() }
  fun setMuted(muted: Boolean) = runOnMain { mediaPlayer?.volume = if (muted) 0 else 100 }
  fun selectAudio(trackId: Int) = runOnMain { mediaPlayer?.audioTrack = trackId }
  fun selectSubtitle(trackId: Int) = runOnMain { mediaPlayer?.spuTrack = trackId }
  fun subtitlesOff() = runOnMain { mediaPlayer?.spuTrack = -1 }
  fun stop(requestedOwner: Owner, releasePlayer: Boolean, onStopped: (() -> Unit)? = null) = runOnMain { if (owner == requestedOwner) stopInternal(releasePlayer); onStopped?.invoke() }
  fun getOwner(): Owner = owner
  fun releaseAll() = runOnMain { stopInternal(true) }
  private fun ensurePlayer(audioOutput: String): MediaPlayer {
    mediaPlayer?.let { return it }
    val context = activity ?: error("Activity unavailable")
    val options = arrayListOf<String>()
    if (audioOutput == "opensles") options.add("--aout=opensles")
    val vlc = LibVLC(context.applicationContext, options).also { libVlc = it }
    return MediaPlayer(vlc).also { player ->
      mediaPlayer = player
      player.setEventListener { event -> when (event.type) {
        MediaPlayer.Event.Opening, MediaPlayer.Event.Buffering -> listener?.onState("loading", null, owner, generation, channelKey)
        MediaPlayer.Event.Playing -> { listener?.onState("playing", null, owner, generation, channelKey); publishTracks(player) }
        MediaPlayer.Event.EncounteredError -> listener?.onState("error", "vlc-playback-error", owner, generation, channelKey)
        MediaPlayer.Event.EndReached -> listener?.onState("error", "stream-ended", owner, generation, channelKey)
      } }
    }
  }
  private fun attachVideoLayout(surfaceOwner: Owner): Boolean {
    val surface = when (surfaceOwner) { Owner.PREVIEW -> previewSurface; Owner.FULLSCREEN -> fullscreenSurface; Owner.NONE -> null } ?: return false
    val context = activity ?: return false
    val layout = videoLayout ?: VLCVideoLayout(context).also { videoLayout = it }
    (layout.parent as? ViewGroup)?.removeView(layout); surface.removeAllViews(); surface.addView(layout, FrameLayout.LayoutParams(-1, -1))
    val player = mediaPlayer ?: return false
    try { player.detachViews() } catch (_: Throwable) {}
    player.attachViews(layout, null, false, false)
    return true
  }
  private fun publishTracks(player: MediaPlayer) {
    val audio = try { player.audioTracks?.map { AudioTrackInfo(it.id, it.name ?: "Audio ${it.id}") } ?: emptyList() } catch (_: Throwable) { emptyList() }
    val subs = try { player.spuTracks?.filter { it.id >= 0 }?.map { SubtitleTrackInfo(it.id, it.name ?: "Subtitle ${it.id}") } ?: emptyList() } catch (_: Throwable) { emptyList() }
    listener?.onTracks(audio, subs, owner, generation, channelKey)
  }
  private fun stopInternal(releasePlayer: Boolean) {
    val player = mediaPlayer; try { player?.stop() } catch (_: Throwable) {}; try { player?.detachViews() } catch (_: Throwable) {}
    videoLayout?.let { (it.parent as? ViewGroup)?.removeView(it) }; owner = Owner.NONE
    if (releasePlayer) { try { player?.release() } catch (_: Throwable) {}; mediaPlayer = null; try { libVlc?.release() } catch (_: Throwable) {}; libVlc = null; videoLayout = null }
  }
  private fun runOnMain(block: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block) }
}
