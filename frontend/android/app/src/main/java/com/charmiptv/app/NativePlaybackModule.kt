package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

class NativePlaybackModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), NativePlaybackManager.Listener {
  override fun getName(): String = "NativePlayback"
  init { NativePlaybackManager.setListener(this) }

  @ReactMethod fun prepareFullscreen(channelKey: String?, uri: String, headers: ReadableMap?, contentType: String?) { attachActivity(); prepareResolved(NativePlaybackManager.Owner.FULLSCREEN, channelKey.orEmpty(), uri, readableMapToStringMap(headers), contentType) }
  @ReactMethod fun preparePreview(channelKey: String?, uri: String, headers: ReadableMap?, contentType: String?) { attachActivity(); prepareResolved(NativePlaybackManager.Owner.PREVIEW, channelKey.orEmpty(), uri, readableMapToStringMap(headers), contentType) }
  @ReactMethod fun resolveFreshSource(requestId: Double, uri: String?, headers: ReadableMap?, contentType: String?, failureReason: String?) { NativePlaybackManager.provideFreshSource(requestId.toLong(), uri, readableMapToStringMap(headers), contentType, failureReason) }
  @ReactMethod fun setResizeMode(mode: String?) { NativePlaybackManager.setResizeMode(mode) }
  @ReactMethod fun pause() { NativePlaybackManager.pause() }
  @ReactMethod fun resume() { NativePlaybackManager.resume() }
  @ReactMethod fun setMuted(muted: Boolean) { NativePlaybackManager.setMuted(muted) }
  @ReactMethod fun selectAudio(groupIndex: Double, trackIndex: Double) { NativePlaybackManager.selectAudio(groupIndex.toInt(), trackIndex.toInt(), null) }
  @ReactMethod fun selectAudioLanguage(language: String?) { NativePlaybackManager.selectAudio(null, null, language) }
  @ReactMethod fun selectSubtitle(groupIndex: Double, trackIndex: Double) { NativePlaybackManager.selectSubtitle(groupIndex.toInt(), trackIndex.toInt(), null) }
  @ReactMethod fun selectSubtitleLanguage(language: String?) { NativePlaybackManager.selectSubtitle(null, null, language) }
  @ReactMethod fun subtitlesOff() { NativePlaybackManager.selectSubtitle(null, null, null) }
  @ReactMethod fun stopPreview(promise: Promise) { stopOwner(NativePlaybackManager.Owner.PREVIEW, releasePlayer = false, promise) }
  @ReactMethod fun stopFullscreen(releasePlayer: Boolean, promise: Promise) { stopOwner(NativePlaybackManager.Owner.FULLSCREEN, releasePlayer, promise) }
  @ReactMethod fun getOwner(promise: Promise) { promise.resolve(NativePlaybackManager.currentOwner().name.lowercase()) }

  /**
   * Only extensionless/opaque HTTP(S) endpoints are probed. Known HLS, DASH,
   * TS and progressive URLs retain the zero-extra-request fast path.
   */
  private fun prepareResolved(owner: NativePlaybackManager.Owner, channelKey: String, uri: String, headers: Map<String, String>, contentType: String?) {
    if (!isOpaqueHttpUrl(uri, contentType)) {
      NativePlaybackManager.prepare(owner, channelKey, uri, headers, contentType)
      return
    }
    val cached = OpaqueStreamProbe.cached(uri)
    if (cached != null) {
      emitProbeDiagnostic(channelKey, uri, cached, cached = true)
      NativePlaybackManager.prepare(owner, channelKey, uri, headers, cached.sourceType)
      return
    }
    OpaqueStreamProbe.probe(uri, headers) { result ->
      val activity = ctx.currentActivity ?: return@probe
      activity.runOnUiThread {
        if (result != null) emitProbeDiagnostic(channelKey, uri, result, cached = false)
        NativePlaybackManager.prepare(owner, channelKey, uri, headers, result?.sourceType ?: contentType)
      }
    }
  }

  private fun isOpaqueHttpUrl(uri: String, contentType: String?): Boolean {
    val clean = uri.substringBefore('|').trim().lowercase(Locale.US)
    if (!(clean.startsWith("http://") || clean.startsWith("https://"))) return false
    val hint = contentType?.trim()?.lowercase(Locale.US).orEmpty()
    if (hint in setOf("hls", "m3u8", "dash", "mpd", "transport", "ts")) return false
    if (clean.contains(".m3u8") || clean.contains(".mpd") || Regex("\\.(?:ts|m2ts|mp4|m4v|m4a|m4s|mov|webm|mkv|avi|flv|mpg|mpeg|vob|mp3|aac|ogg|wav|flac|amr|cmfv|cmfa)(?:$|[?#])").containsMatchIn(clean)) return false
    if (clean.contains("/hls/") || clean.contains("/dash/") || clean.contains("format=m3u8") || clean.contains("type=hls") || clean.contains("format=mpd") || clean.contains("type=dash") || clean.contains("mpegts") || clean.contains("mpeg-ts") || Regex("[?&](?:format|type|output)=(?:ts|mpegts|mpeg-ts)(?:&|$)").containsMatchIn(clean)) return false
    return true
  }

  private fun emitProbeDiagnostic(channelKey: String, originalUrl: String, result: OpaqueStreamProbe.Result, cached: Boolean) {
    emit("NativePlaybackOpaqueProbe", Arguments.createMap().apply {
      putString("channelKey", channelKey)
      putString("sourceType", result.sourceType)
      putString("mimeType", result.mimeType)
      putInt("httpResponseCode", result.httpCode)
      putString("signature", result.signature)
      putBoolean("redirected", result.finalUrl != originalUrl)
      putBoolean("cached", cached)
    })
  }

  override fun onState(state: String, reason: String?) {
    val event = Arguments.createMap().apply { putString("owner", NativePlaybackManager.currentOwner().name.lowercase()); putString("state", state); if (reason != null) putString("reason", reason) }
    emit("NativePlaybackState", event)
  }

  override fun onTracks(audio: List<NativePlaybackManager.AudioTrackInfo>, subtitles: List<NativePlaybackManager.SubtitleTrackInfo>) {
    val audioArray = Arguments.createArray(); audio.forEach { track -> audioArray.pushMap(Arguments.createMap().apply { putInt("groupIndex", track.groupIndex); putInt("trackIndex", track.trackIndex); putString("id", track.id); putString("name", track.label); putString("language", track.language); putString("mimeType", track.mimeType); putBoolean("isSupported", track.supported) }) }
    val textArray = Arguments.createArray(); subtitles.forEach { track -> textArray.pushMap(Arguments.createMap().apply { putInt("groupIndex", track.groupIndex); putInt("trackIndex", track.trackIndex); putString("id", track.id); putString("name", track.label); putString("language", track.language) }) }
    emit("NativePlaybackTracks", Arguments.createMap().apply { putString("owner", NativePlaybackManager.currentOwner().name.lowercase()); putArray("audio", audioArray); putArray("text", textArray) })
  }

  override fun onSourceRefreshRequested(request: NativePlaybackManager.SourceRefreshRequest) {
    emit("NativePlaybackSourceRefreshRequested", Arguments.createMap().apply {
      putDouble("requestId", request.requestId.toDouble())
      putString("owner", request.owner.name.lowercase())
      putString("channelKey", request.channelKey)
      putInt("recoveryAttempt", request.recoveryAttempt)
      putString("reason", request.reason)
      putBoolean("authenticationFailure", request.authenticationFailure)
    })
  }

  override fun onDiagnostic(diagnostic: NativePlaybackManager.PlaybackDiagnostic) {
    val epg = Arguments.createMap()
    diagnostic.epgRamStats.forEach { (key, value) -> epg.putDouble(key, value.toDouble()) }
    emit("NativePlaybackDiagnostics", Arguments.createMap().apply {
      putString("owner", NativePlaybackManager.currentOwner().name.lowercase())
      putString("event", diagnostic.event)
      if (diagnostic.media3ErrorCode != null) putInt("media3ErrorCode", diagnostic.media3ErrorCode) else putNull("media3ErrorCode")
      if (diagnostic.media3ErrorCodeName != null) putString("media3ErrorCodeName", diagnostic.media3ErrorCodeName) else putNull("media3ErrorCodeName")
      if (diagnostic.httpResponseCode != null) putInt("httpResponseCode", diagnostic.httpResponseCode) else putNull("httpResponseCode")
      if (diagnostic.exceptionType != null) putString("exceptionType", diagnostic.exceptionType) else putNull("exceptionType")
      putString("causeChain", diagnostic.causeChain.joinToString(" <- "))
      putString("playbackState", diagnostic.playbackState)
      putDouble("bufferedDurationMs", diagnostic.bufferedDurationMs.toDouble())
      putDouble("bufferedPositionMs", diagnostic.bufferedPositionMs.toDouble())
      putDouble("positionMs", diagnostic.positionMs.toDouble())
      if (diagnostic.contentType != null) putString("contentType", diagnostic.contentType) else putNull("contentType")
      if (diagnostic.sourceType != null) putString("sourceType", diagnostic.sourceType) else putNull("sourceType")
      putInt("recoveryAttempt", diagnostic.recoveryAttempt)
      putBoolean("lowRam", diagnostic.lowRam)
      putDouble("heapUsedBytes", diagnostic.heapUsedBytes.toDouble())
      putDouble("heapMaxBytes", diagnostic.heapMaxBytes.toDouble())
      putMap("epgRam", epg)
    })
  }

  private fun stopOwner(requestedOwner: NativePlaybackManager.Owner, releasePlayer: Boolean, promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) { promise.resolve(null); return }
    activity.runOnUiThread {
      if (NativePlaybackManager.currentOwner() != requestedOwner) { promise.resolve(null); return@runOnUiThread }
      NativePlaybackManager.stop(requestedOwner, releasePlayer) { promise.resolve(null) }
    }
  }

  private fun attachActivity() { ctx.currentActivity?.let(NativePlaybackManager::installIntoActivity) }
  private fun emit(name: String, value: Any) { try { ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value) } catch (_: Throwable) {} }
  private fun readableMapToStringMap(readable: ReadableMap?): Map<String, String> {
    if (readable == null) return emptyMap(); val out = LinkedHashMap<String, String>(); val iterator = readable.keySetIterator()
    while (iterator.hasNextKey()) { val key = iterator.nextKey(); try { val value = readable.getString(key); if (!value.isNullOrBlank()) out[key] = value } catch (_: Throwable) {} }
    return out
  }
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
