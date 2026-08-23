package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class NativeVlcPlaybackModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext), NativeVlcPlaybackManager.Listener {
  override fun getName(): String = "NativeVlcPlayback"
  init { NativeVlcPlaybackManager.setListener(this) }
  @ReactMethod fun prepareFullscreen(generation: Double, channelKey: String, uri: String, headers: ReadableMap?, hardwareDecode: Boolean, audioOutput: String, bufferProfile: String) = prepare(NativeVlcPlaybackManager.Owner.FULLSCREEN, generation, channelKey, uri, headers, hardwareDecode, audioOutput, bufferProfile)
  @ReactMethod fun preparePreview(generation: Double, channelKey: String, uri: String, headers: ReadableMap?, hardwareDecode: Boolean, audioOutput: String, bufferProfile: String) = prepare(NativeVlcPlaybackManager.Owner.PREVIEW, generation, channelKey, uri, headers, hardwareDecode, audioOutput, bufferProfile)
  private fun prepare(owner: NativeVlcPlaybackManager.Owner, generation: Double, channelKey: String, uri: String, headers: ReadableMap?, hardwareDecode: Boolean, audioOutput: String, bufferProfile: String) {
    currentActivity?.let { NativeVlcPlaybackManager.installIntoActivity(it) }
    val mapped = linkedMapOf<String, String>(); headers?.toHashMap()?.forEach { (k, v) -> if (v != null) mapped[k] = v.toString() }
    NativeVlcPlaybackManager.prepare(owner, generation.toLong(), channelKey, uri, mapped, hardwareDecode, audioOutput, bufferProfile)
  }
  @ReactMethod fun setResizeMode(mode: String?) { NativeVlcPlaybackManager.setResizeMode(mode) }
  @ReactMethod fun pause() { NativeVlcPlaybackManager.pause() }
  @ReactMethod fun resume() { NativeVlcPlaybackManager.resume() }
  @ReactMethod fun setMuted(muted: Boolean) { NativeVlcPlaybackManager.setMuted(muted) }
  @ReactMethod fun selectAudio(trackId: Double) { NativeVlcPlaybackManager.selectAudio(trackId.toInt()) }
  @ReactMethod fun selectSubtitle(trackId: Double) { NativeVlcPlaybackManager.selectSubtitle(trackId.toInt()) }
  @ReactMethod fun subtitlesOff() { NativeVlcPlaybackManager.subtitlesOff() }
  @ReactMethod fun stopPreview(releasePlayer: Boolean, promise: Promise) = NativeVlcPlaybackManager.stop(NativeVlcPlaybackManager.Owner.PREVIEW, releasePlayer) { promise.resolve(null) }
  @ReactMethod fun stopFullscreen(releasePlayer: Boolean, promise: Promise) = NativeVlcPlaybackManager.stop(NativeVlcPlaybackManager.Owner.FULLSCREEN, releasePlayer) { promise.resolve(null) }
  @ReactMethod fun getOwner(promise: Promise) { promise.resolve(when (NativeVlcPlaybackManager.getOwner()) { NativeVlcPlaybackManager.Owner.PREVIEW -> "preview"; NativeVlcPlaybackManager.Owner.FULLSCREEN -> "fullscreen"; else -> "none" }) }
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit
  override fun onState(state: String, reason: String?, owner: NativeVlcPlaybackManager.Owner, generation: Long, channelKey: String) {
    val payload = Arguments.createMap().apply { putString("state", state); if (reason != null) putString("reason", reason); putString("owner", owner.name.lowercase()); putDouble("generation", generation.toDouble()); putString("channelKey", channelKey) }
    emit("NativeVlcPlaybackState", payload)
  }
  override fun onTracks(audio: List<NativeVlcPlaybackManager.AudioTrackInfo>, subtitles: List<NativeVlcPlaybackManager.SubtitleTrackInfo>, owner: NativeVlcPlaybackManager.Owner, generation: Long, channelKey: String) {
    val a = Arguments.createArray(); audio.forEach { t -> a.pushMap(Arguments.createMap().apply { putInt("id", t.id); putString("name", t.label); putBoolean("isSupported", true) }) }
    val s = Arguments.createArray(); subtitles.forEach { t -> s.pushMap(Arguments.createMap().apply { putInt("id", t.id); putString("name", t.label); putBoolean("isSupported", true) }) }
    val payload = Arguments.createMap().apply { putString("owner", owner.name.lowercase()); putDouble("generation", generation.toDouble()); putString("channelKey", channelKey); putArray("audio", a); putArray("text", s) }
    emit("NativeVlcPlaybackTracks", payload)
  }
  private fun emit(name: String, payload: com.facebook.react.bridge.WritableMap) { reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, payload) }
}
