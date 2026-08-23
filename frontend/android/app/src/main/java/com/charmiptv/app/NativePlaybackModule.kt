package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class NativePlaybackModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), NativePlaybackManager.Listener {
  override fun getName(): String = "NativePlayback"
  init { NativePlaybackManager.setListener(this) }

  @ReactMethod fun prepareFullscreen(channelKey: String?, uri: String, headers: ReadableMap?, contentType: String?) { attachActivity(); NativePlaybackManager.prepare(NativePlaybackManager.Owner.FULLSCREEN, channelKey.orEmpty(), uri, readableMapToStringMap(headers), contentType) }
  @ReactMethod fun preparePreview(channelKey: String?, uri: String, headers: ReadableMap?, contentType: String?) { attachActivity(); NativePlaybackManager.prepare(NativePlaybackManager.Owner.PREVIEW, channelKey.orEmpty(), uri, readableMapToStringMap(headers), contentType) }
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
      if (diagnostic.errorSummary != null) putString("errorSummary", diagnostic.errorSummary) else putNull("errorSummary")
      putString("causeChain", diagnostic.causeChain.joinToString(" <- "))
      putString("playbackState", diagnostic.playbackState)
      putDouble("bufferedDurationMs", diagnostic.bufferedDurationMs.toDouble())
      putDouble("bufferedPositionMs", diagnostic.bufferedPositionMs.toDouble())
      putDouble("positionMs", diagnostic.positionMs.toDouble())
      if (diagnostic.channelKey != null) putString("channelKey", diagnostic.channelKey) else putNull("channelKey")
      if (diagnostic.contentType != null) putString("contentType", diagnostic.contentType) else putNull("contentType")
      if (diagnostic.sourceType != null) putString("sourceType", diagnostic.sourceType) else putNull("sourceType")
      if (diagnostic.detectedContainer != null) putString("detectedContainer", diagnostic.detectedContainer) else putNull("detectedContainer")
      if (diagnostic.detectedMimeType != null) putString("detectedMimeType", diagnostic.detectedMimeType) else putNull("detectedMimeType")
      if (diagnostic.resolvedUri != null) putString("resolvedUri", diagnostic.resolvedUri) else putNull("resolvedUri")
      if (diagnostic.probeHttpResponseCode != null) putInt("probeHttpResponseCode", diagnostic.probeHttpResponseCode) else putNull("probeHttpResponseCode")
      if (diagnostic.probeReason != null) putString("probeReason", diagnostic.probeReason) else putNull("probeReason")
      if (diagnostic.videoMimeType != null) putString("videoMimeType", diagnostic.videoMimeType) else putNull("videoMimeType")
      if (diagnostic.videoCodecs != null) putString("videoCodecs", diagnostic.videoCodecs) else putNull("videoCodecs")
      if (diagnostic.audioMimeType != null) putString("audioMimeType", diagnostic.audioMimeType) else putNull("audioMimeType")
      if (diagnostic.audioCodecs != null) putString("audioCodecs", diagnostic.audioCodecs) else putNull("audioCodecs")
      if (diagnostic.videoWidth != null) putInt("videoWidth", diagnostic.videoWidth) else putNull("videoWidth")
      if (diagnostic.videoHeight != null) putInt("videoHeight", diagnostic.videoHeight) else putNull("videoHeight")
      if (diagnostic.videoDecoder != null) putString("videoDecoder", diagnostic.videoDecoder) else putNull("videoDecoder")
      if (diagnostic.audioDecoder != null) putString("audioDecoder", diagnostic.audioDecoder) else putNull("audioDecoder")
      if (diagnostic.codecError != null) putString("codecError", diagnostic.codecError) else putNull("codecError")
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
