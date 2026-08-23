package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class NativeVlcPlaybackModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx),
  NativeVlcPlaybackManager.Listener,
  LifecycleEventListener {

  override fun getName(): String = "NativeVlcPlayback"

  init {
    NativeVlcPlaybackManager.setListener(this)
    ctx.addLifecycleEventListener(this)
  }

  @ReactMethod
  fun prepareFullscreen(
    generation: Double,
    channelKey: String?,
    uri: String,
    headers: ReadableMap?,
    hardwareDecode: Boolean,
    audioOutput: String?,
    bufferProfile: String?,
  ) {
    attachActivity()
    NativeVlcPlaybackManager.prepare(
      NativeVlcPlaybackManager.Owner.FULLSCREEN,
      generation.toLong(),
      channelKey.orEmpty(),
      uri,
      readableMapToStringMap(headers),
      hardwareDecode,
      audioOutput.orEmpty(),
      bufferProfile.orEmpty(),
    )
  }

  @ReactMethod
  fun preparePreview(
    generation: Double,
    channelKey: String?,
    uri: String,
    headers: ReadableMap?,
    hardwareDecode: Boolean,
    audioOutput: String?,
    bufferProfile: String?,
  ) {
    attachActivity()
    NativeVlcPlaybackManager.prepare(
      NativeVlcPlaybackManager.Owner.PREVIEW,
      generation.toLong(),
      channelKey.orEmpty(),
      uri,
      readableMapToStringMap(headers),
      hardwareDecode,
      audioOutput.orEmpty(),
      bufferProfile.orEmpty(),
    )
  }

  @ReactMethod fun setResizeMode(mode: String?) { NativeVlcPlaybackManager.setResizeMode(mode) }
  @ReactMethod fun pause() { NativeVlcPlaybackManager.pause() }
  @ReactMethod fun resume() { NativeVlcPlaybackManager.resume() }
  @ReactMethod fun setMuted(muted: Boolean) { NativeVlcPlaybackManager.setMuted(muted) }
  @ReactMethod fun selectAudio(trackId: Double) { NativeVlcPlaybackManager.selectAudio(trackId.toInt()) }
  @ReactMethod fun selectSubtitle(trackId: Double) { NativeVlcPlaybackManager.selectSubtitle(trackId.toInt()) }
  @ReactMethod fun subtitlesOff() { NativeVlcPlaybackManager.selectSubtitle(null) }
  @ReactMethod fun stopPreview(releasePlayer: Boolean, promise: Promise) { stopOwner(NativeVlcPlaybackManager.Owner.PREVIEW, releasePlayer, promise) }
  @ReactMethod fun stopFullscreen(releasePlayer: Boolean, promise: Promise) { stopOwner(NativeVlcPlaybackManager.Owner.FULLSCREEN, releasePlayer, promise) }
  @ReactMethod fun getOwner(promise: Promise) { promise.resolve(NativeVlcPlaybackManager.currentOwner().name.lowercase()) }

  override fun onState(identity: NativeVlcPlaybackManager.Identity, state: String, reason: String?) {
    emit("NativeVlcPlaybackState", Arguments.createMap().apply {
      putString("owner", identity.owner.name.lowercase())
      putDouble("generation", identity.generation.toDouble())
      putString("channelKey", identity.channelKey)
      putString("state", state)
      if (reason != null) putString("reason", reason)
    })
  }

  override fun onTracks(
    identity: NativeVlcPlaybackManager.Identity,
    audio: List<NativeVlcPlaybackManager.TrackInfo>,
    subtitles: List<NativeVlcPlaybackManager.TrackInfo>,
  ) {
    val audioArray = Arguments.createArray()
    audio.forEach { track ->
      audioArray.pushMap(Arguments.createMap().apply {
        putInt("groupIndex", 0)
        putInt("trackIndex", track.id)
        putString("id", track.id.toString())
        putString("name", track.label)
        putBoolean("isSupported", true)
      })
    }
    val textArray = Arguments.createArray()
    subtitles.forEach { track ->
      textArray.pushMap(Arguments.createMap().apply {
        putInt("groupIndex", 0)
        putInt("trackIndex", track.id)
        putString("id", track.id.toString())
        putString("name", track.label)
      })
    }
    emit("NativeVlcPlaybackTracks", Arguments.createMap().apply {
      putString("owner", identity.owner.name.lowercase())
      putDouble("generation", identity.generation.toDouble())
      putString("channelKey", identity.channelKey)
      putArray("audio", audioArray)
      putArray("text", textArray)
    })
  }

  override fun onHostResume() = Unit
  override fun onHostPause() { NativeVlcPlaybackManager.pause() }
  override fun onHostDestroy() { NativeVlcPlaybackManager.releaseAll() }

  override fun invalidate() {
    try { ctx.removeLifecycleEventListener(this) } catch (_: Throwable) {}
    NativeVlcPlaybackManager.setListener(null)
    NativeVlcPlaybackManager.releaseAll()
    super.invalidate()
  }

  private fun stopOwner(owner: NativeVlcPlaybackManager.Owner, releasePlayer: Boolean, promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      NativeVlcPlaybackManager.stop(owner, releasePlayer) { promise.resolve(null) }
      return
    }
    activity.runOnUiThread {
      NativeVlcPlaybackManager.stop(owner, releasePlayer) { promise.resolve(null) }
    }
  }

  private fun attachActivity() { ctx.currentActivity?.let(NativeVlcPlaybackManager::installIntoActivity) }

  private fun emit(name: String, value: Any) {
    try { ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value) } catch (_: Throwable) {}
  }

  private fun readableMapToStringMap(readable: ReadableMap?): Map<String, String> {
    if (readable == null) return emptyMap()
    val out = LinkedHashMap<String, String>()
    val iterator = readable.keySetIterator()
    while (iterator.hasNextKey()) {
      val key = iterator.nextKey()
      try {
        val value = readable.getString(key)
        if (!value.isNullOrBlank()) out[key] = value
      } catch (_: Throwable) {}
    }
    return out
  }

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit
}
