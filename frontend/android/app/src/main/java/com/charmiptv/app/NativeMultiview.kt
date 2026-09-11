package com.charmiptv.app

import android.content.Context
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.widget.FrameLayout
import androidx.media3.common.*
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.*
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.PlayerView
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import java.lang.ref.WeakReference

/** All operations run on the main looper. Session + pane revision reject stale React work. */
internal object NativeMultiview {
  private data class Pane(val revision: Int, val channel: String, val uri: String, val headers: Map<String,String>, val type: String?) {
    var player: ExoPlayer? = null
  }
  private val panes = mutableMapOf<Int, Pane>()
  private val surfaces = mutableMapOf<Int, WeakReference<MultiviewSurface>>()
  private val revisions = IntArray(MultiviewPolicy.MAX_PANES) { -1 }
  private val main = Handler(Looper.getMainLooper())
  private var context: ReactApplicationContext? = null
  var session: String? = null; private set
  val active get() = session != null
  private var audible = -1
  private var paused = false
  private var releaseFailed = false
  private var focused = false
  private var audioLanguage = ""
  private var textLanguage = ""
  private val http = CharmHttpClients.mediaClient()
  private val audioFocus = AudioManager.OnAudioFocusChangeListener { change ->
    focused = change > 0
    panes.values.forEach { it.player?.playWhenReady = !paused && focused }
  }
  private fun audio() = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  fun begin(ctx: ReactApplicationContext, token: String, promise: Promise) {
    if (active && session != token) { promise.reject("E_MULTIVIEW_BUSY", "Close the current multiview session first."); return }
    if (releaseFailed) { promise.reject("E_MULTIVIEW_RELEASE", "Restart the app before starting more streams."); return }
    NativePlaybackManager.stop(NativePlaybackManager.currentOwner(), true) { failure ->
      if (failure != null) promise.reject("E_MULTIVIEW_RELEASE", "The previous player could not close.")
      else {
        context = ctx; session = token; paused = false
        focused = audio()?.requestAudioFocus(audioFocus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        EpgImportCoordinator.playbackActive = true
        promise.resolve(null)
      }
    }
  }
  fun prepare(token: String, slot: Int, revision: Int, channel: String, uri: String, headers: Map<String,String>, type: String?) {
    if (session != token || !MultiviewPolicy.validSlot(slot) || releaseFailed) return
    if (revisions[slot] >= revision) return
    if (panes[slot]?.let { it.revision == revision && it.channel == channel } == true) return
    require(android.net.Uri.parse(uri).scheme?.lowercase() in listOf("https", "http", "rtsp")) { "Unsupported stream protocol" }
    revisions[slot] = revision
    val old = panes.remove(slot)
    if (!release(old)) { emit(slot, revision, "error", "A decoder could not close. Restart the app."); return }
    val pane = Pane(revision, channel, uri, headers, type)
    panes[slot] = pane
    if (audible < 0) audible = slot
    if (!paused) create(slot, pane)
  }
  private fun create(slot: Int, pane: Pane) {
    val ctx = context ?: return
    if (releaseFailed || pane.player != null) return
    emit(slot, pane.revision, "loading")
    try {
      val properties = linkedMapOf("User-Agent" to "TiviMate/5.1.6 (Linux; Android TV)", "Accept" to "*/*")
      pane.headers.forEach { (key,value) -> properties.keys.firstOrNull { it.equals(key, true) }?.let(properties::remove); properties[key] = value }
      val client = CharmHttpClients.mediaClientForHeaders(http, properties)
      val data = DefaultDataSource.Factory(ctx, OkHttpDataSource.Factory(client).setDefaultRequestProperties(properties))
      val extractors = DefaultExtractorsFactory().setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS)
      val media = DefaultMediaSourceFactory(data, extractors)
      val renderers = DefaultRenderersFactory(ctx).setEnableDecoderFallback(true)
        .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
      val player = ExoPlayer.Builder(ctx).setRenderersFactory(renderers).setMediaSourceFactory(media)
        .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(4000, 15000, 1000, 2000)
          .setTargetBufferBytes(MultiviewPolicy.PANE_BUFFER_BYTES).setPrioritizeTimeOverSizeThresholds(false).build()).build()
      pane.player = player
      player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
        .setMaxVideoSize(1920, 1080).setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, slot != audible)
        .setPreferredAudioLanguage(audioLanguage).setPreferredTextLanguage(textLanguage)
        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, textLanguage.isBlank()).build()
      player.addListener(object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
          if (panes[slot] !== pane || pane.player !== player) return
          emit(slot, pane.revision, when (state) { Player.STATE_READY -> "playing"; Player.STATE_ENDED -> "ended"; else -> "loading" })
        }
        override fun onPlayerError(error: PlaybackException) {
          if (panes[slot] !== pane || pane.player !== player) return
          // Never expose a signed URL, credentials or the provider's response body.
          val reason = if (error.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED) "Device decoder limit reached. Close a pane or choose a lighter stream." else "This stream could not play. Retry or change channel."
          emit(slot, pane.revision, "error", reason)
          release(pane)
        }
      })
      val item = MediaItem.Builder().setUri(pane.uri).apply {
        when(pane.type) { "hls" -> setMimeType(MimeTypes.APPLICATION_M3U8); "dash" -> setMimeType(MimeTypes.APPLICATION_MPD); "transport" -> setMimeType(MimeTypes.VIDEO_MP2T) }
      }.build()
      if (pane.type == "hls") player.setMediaSource(HlsMediaSource.Factory(data).setExtractorFactory(DefaultHlsExtractorFactory(
        DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS, true)).createMediaSource(item))
      else player.setMediaItem(item)
      attach(slot); player.prepare(); player.playWhenReady = focused
      main.postAtTime({
        if (panes[slot] === pane && pane.player === player && player.playbackState != Player.STATE_READY && !paused) {
          release(pane); emit(slot,pane.revision,"error","This channel took too long to start. Retry or change channel.")
        }
      }, pane, android.os.SystemClock.uptimeMillis() + 30_000)
    } catch (_: Exception) { release(pane); emit(slot, pane.revision, "error", "This stream could not start. Try fewer panes or another channel.") }
  }
  private fun release(pane: Pane?): Boolean {
    if (pane != null) main.removeCallbacksAndMessages(pane)
    val player = pane?.player ?: return !releaseFailed
    surfaces.values.forEach { ref -> ref.get()?.playerView?.let { if (it.player === player) it.player = null } }
    return try { player.release(); pane.player = null; true }
    catch (_: Exception) { releaseFailed = true; false }
  }
  fun listen(token: String, slot: Int) {
    if (token != session || slot !in panes) return
    audible = slot
    panes.forEach { (id,p) -> p.player?.let { player -> player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, id != slot).build() } }
  }
  fun preferences(token: String, audio: String, text: String) {
    if (session != token) return
    audioLanguage = audio.take(32); textLanguage = text.take(32)
    panes.values.forEach { pane -> pane.player?.let { player -> player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
      .setPreferredAudioLanguage(audioLanguage).setPreferredTextLanguage(textLanguage).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, textLanguage.isBlank()).build() } }
  }
  fun tracks(token: String, slot: Int, subtitles: Boolean) {
    if (session != token) return
    val player = panes[slot]?.player ?: return
    val activity = context?.currentActivity ?: return
    val type = if (subtitles) C.TRACK_TYPE_TEXT else C.TRACK_TYPE_AUDIO
    val tracks = player.currentTracks.groups.filter { it.type == type }.flatMap { group ->
      (0 until group.length).filter { group.isTrackSupported(it) }.map { index -> group to index }
    }
    val labels = listOf(if (subtitles) "Off" else "Automatic") + tracks.map { (group,index) ->
      group.getTrackFormat(index).let { it.label ?: it.language ?: "Track ${index + 1}" }
    }
    android.app.AlertDialog.Builder(activity).setTitle(if(subtitles) "Captions" else "Audio")
      .setItems(labels.toTypedArray()) { _, index ->
        if (session == token && panes[slot]?.player === player) {
          val builder = player.trackSelectionParameters.buildUpon().clearOverridesOfType(type)
          if (index == 0) builder.setTrackTypeDisabled(type, subtitles)
          else tracks.getOrNull(index-1)?.let { (group,track) -> builder.setTrackTypeDisabled(type,false).addOverride(TrackSelectionOverride(group.mediaTrackGroup,track)) }
          player.trackSelectionParameters = builder.build()
        }
      }.setNegativeButton("Close",null).show()
  }
  fun remove(token: String, slot: Int, revision: Int) {
    if (token != session || !MultiviewPolicy.validSlot(slot) || revisions[slot] > revision) return
    revisions[slot] = revision
    release(panes.remove(slot))
    audible = MultiviewPolicy.audioAfterRemoval(audible, slot, panes.keys)
    if (audible >= 0) listen(token, audible)
  }
  fun suspendSession(token: String) {
    if (token != session) return
    paused = true; panes.values.forEach { release(it) }; audio()?.abandonAudioFocus(audioFocus); focused = false
  }
  fun resumeSession(token: String) {
    if (token != session || !paused) return
    paused = false
    focused = audio()?.requestAudioFocus(audioFocus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    panes.forEach { (slot, pane) -> create(slot, pane) }
  }
  fun end(token: String): Boolean {
    if (token != session) return true
    suspendSession(token)
    if (releaseFailed) return false
    panes.clear(); surfaces.clear(); revisions.fill(-1); main.removeCallbacksAndMessages(null); audible = -1; session = null; context = null
    EpgImportCoordinator.playbackActive = false
    return true
  }
  fun memoryPressure() {
    if (!active) return
    panes.forEach { (slot,pane) -> release(pane); emit(slot, pane.revision, "error", "Device memory is low. Close some panes before retrying.") }
  }
  fun bind(surface: MultiviewSurface) {
    if (surface.token != session || !MultiviewPolicy.validSlot(surface.slot)) return
    surfaces[surface.slot]?.get()?.takeIf { it !== surface }?.playerView?.player = null
    surfaces[surface.slot] = WeakReference(surface); attach(surface.slot)
  }
  private fun attach(slot: Int) { surfaces[slot]?.get()?.playerView?.player = panes[slot]?.player }
  fun unbind(surface: MultiviewSurface) {
    surface.playerView.player = null
    if (surfaces[surface.slot]?.get() === surface) surfaces.remove(surface.slot)
  }
  private fun emit(slot: Int, revision: Int, state: String, reason: String? = null) {
    val ctx = context ?: return
    try { ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CharmMultiviewState", Arguments.createMap().apply {
      putString("session", session); putInt("slot",slot); putInt("revision",revision); putString("state",state); putString("reason",reason)
    }) } catch (_: Exception) { }
  }
}

class MultiviewModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), LifecycleEventListener, ComponentCallbacks2 {
  private val main = Handler(Looper.getMainLooper())
  override fun getName() = "CharmMultiview"
  init { ctx.addLifecycleEventListener(this); ctx.registerComponentCallbacks(this) }
  private fun onMain(action: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post(action) }
  @ReactMethod fun begin(token: String, promise: Promise) = onMain { NativeMultiview.begin(ctx, token, promise) }
  @ReactMethod fun prepare(token: String, slot: Int, revision: Int, channel: String, uri: String, headers: ReadableMap, type: String?, promise: Promise) {
    val map = headers.toHashMap().mapValues { it.value.toString() }
    onMain { try { NativeMultiview.prepare(token,slot,revision,channel,uri,map,type); promise.resolve(null) } catch (_: Exception) { promise.reject("E_MULTIVIEW_SOURCE", "This channel could not be opened.") } }
  }
  @ReactMethod fun listen(token: String, slot: Int) = onMain { NativeMultiview.listen(token,slot) }
  @ReactMethod fun tracks(token: String, slot: Int, subtitles: Boolean) = onMain { NativeMultiview.tracks(token,slot,subtitles) }
  @ReactMethod fun preferences(token: String, audio: String, text: String) = onMain { NativeMultiview.preferences(token,audio,text) }
  @ReactMethod fun remove(token: String, slot: Int, revision: Int) = onMain { NativeMultiview.remove(token,slot,revision) }
  @ReactMethod fun suspend(token: String) = onMain { NativeMultiview.suspendSession(token) }
  @ReactMethod fun resume(token: String) = onMain { NativeMultiview.resumeSession(token) }
  @ReactMethod fun end(token: String, promise: Promise) = onMain { if (NativeMultiview.end(token)) promise.resolve(null) else promise.reject("E_MULTIVIEW_RELEASE", "Restart the app: a decoder could not close.") }
  @ReactMethod fun addListener(name: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit
  override fun onHostPause() = onMain { NativeMultiview.session?.let(NativeMultiview::suspendSession) }
  override fun onHostResume() = onMain { NativeMultiview.session?.let(NativeMultiview::resumeSession) }
  override fun onHostDestroy() = onMain { NativeMultiview.session?.let(NativeMultiview::end) }
  override fun onLowMemory() = onMain { NativeMultiview.memoryPressure() }
  override fun onTrimMemory(level: Int) { if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL || level == ComponentCallbacks2.TRIM_MEMORY_COMPLETE) onLowMemory() }
  override fun onConfigurationChanged(configuration: Configuration) = Unit
  override fun invalidate() { ctx.removeLifecycleEventListener(this); ctx.unregisterComponentCallbacks(this); onHostDestroy(); super.invalidate() }
}

class MultiviewSurface(context: Context) : FrameLayout(context) {
  var slot = -1
  var token: String? = null
  val playerView = LayoutInflater.from(context).inflate(R.layout.charm_multiview_surface, this, false) as PlayerView
  init { addView(playerView, LayoutParams(-1,-1)); playerView.useController = false; playerView.isFocusable = false; keepScreenOn = true }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); NativeMultiview.bind(this) }
  fun changed() { NativeMultiview.bind(this) }
}
class MultiviewSurfaceManager : SimpleViewManager<MultiviewSurface>() {
  override fun getName() = "CharmMultiviewSurface"
  override fun createViewInstance(context: ThemedReactContext) = MultiviewSurface(context)
  @ReactProp(name="slot") fun slot(view: MultiviewSurface, slot: Int) { NativeMultiview.unbind(view); view.slot=slot; view.changed() }
  @ReactProp(name="session") fun token(view: MultiviewSurface, token: String?) { NativeMultiview.unbind(view); view.token=token; view.changed() }
  override fun onDropViewInstance(view: MultiviewSurface) { NativeMultiview.unbind(view); super.onDropViewInstance(view) }
}
