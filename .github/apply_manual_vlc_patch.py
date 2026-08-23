from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")

def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f"missing patch anchor in {path}: {old[:100]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"non-unique patch anchor in {path}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))

# Register the direct native VLC package.
replace_once(
    "frontend/android/app/src/main/java/com/charmiptv/app/MainApplication.kt",
    "              add(NativePlaybackPackage())\n",
    "              add(NativePlaybackPackage())\n              add(NativeVlcPlaybackPackage())\n",
)

# LibVLC dependency + safe native runtime resolution + truthful HTTP comment.
gradle = "frontend/android/app/build.gradle"
replace_once(
    gradle,
    "            // Tester/provider builds retain explicit legacy HTTP compatibility;\n            // production release builds stay HTTPS-only by default.\n            manifestPlaceholders.allowCleartextStreams = \"true\"\n",
    "            // IPTV provider streams intentionally retain cleartext HTTP support in\n            // sideload builds; many Xtream-style providers do not offer HTTPS.\n            manifestPlaceholders.allowCleartextStreams = \"true\"\n",
)
replace_once(
    gradle,
    "    implementation(\"androidx.media3:media3-exoplayer-dash:1.8.0\")\n",
    "    implementation(\"androidx.media3:media3-exoplayer-dash:1.8.0\")\n    // Manual compatibility engine. It is never started automatically beside Media3.\n    implementation(\"org.videolan.android:libvlc-all:3.7.5\")\n",
)
replace_once(
    gradle,
    "dependencies {\n",
    '''// React Native and LibVLC both ship libc++_shared.so. LibVLC must keep its\n// compatible runtime; blindly pickFirst-ing React Native's copy can compile and\n// then crash inside LibVLC. Remove only React Native's duplicate before native\n// library merge. mergeSideloadNativeLibs is exercised by the validation gate.\ntasks.configureEach { task ->\n    if (task.name.startsWith("merge") && task.name.endsWith("NativeLibs")) {\n        task.doFirst {\n            def external = task.hasProperty("externalLibNativeLibs") ? task.externalLibNativeLibs : null\n            if (external == null) return\n            external.files.findAll { root ->\n                def value = root.toString()\n                value.contains("react-android") || value.contains("jetified-react-native")\n            }.each { root ->\n                if (!root.exists()) return\n                fileTree(root).matching { include "**/libc++_shared.so" }.files.each { duplicate ->\n                    duplicate.delete()\n                }\n            }\n        }\n    }\n}\n\ndependencies {\n''',
)

# Protocol capability must be explicit; unsupported protocols never get silently
# mislabeled progressive in Media3.
policy = "frontend/src/core/streamPolicy.ts"
replace_once(policy, 'export type Engine = "media3";\n', 'export type Engine = "media3" | "vlc";\n')
replace_once(
    policy,
    '''export function preferredEngine(_kind: StreamKind): Engine {\n  return "media3";\n}\n\n''',
    '''export function isNativeMedia3SupportedStreamKind(kind: StreamKind): boolean {\n  return kind === "hls" || kind === "dash" || kind === "progressive" || kind === "transport" || kind === "unknown";\n}\n\nexport function isVlcSupportedStreamKind(kind: StreamKind): boolean {\n  // LibVLC handles ordinary files plus HLS/DASH/TS and the RTSP/RTMP/SRT\n  // compatibility cases. WebRTC is not advertised because this build does not\n  // provide a WebRTC signaling/session implementation.\n  return kind !== "webrtc";\n}\n\nexport function preferredEngine(_kind: StreamKind): Engine {\n  // Manual preference is applied by StreamPlayer. There is intentionally no\n  // automatic Media3↔VLC fallback loop.\n  return "media3";\n}\n\n''',
)
replace_once(
    policy,
    ''' * Media3 contentType hint for the native source factory. Unknown HTTP(S) URLs\n * deliberately remain unknown so Android can perform the bounded response/body\n * probe instead of prematurely locking an opaque HLS/TS/DASH URL to progressive.\n''',
    ''' * Media3 contentType hint for the native source factory. Unknown HTTP(S) URLs\n * deliberately remain unknown so the native learned-type cache and bounded\n * single-player candidate router can classify them without a second sniff request.\n''',
)

# Media3 native bridge now carries generation + channel identity and owns lifecycle cleanup.
write("frontend/src/nativePlayback.ts", r'''import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export type NativePlaybackOwner = "none" | "preview" | "fullscreen";
export type NativePlaybackState = "loading" | "playing" | "error";

export type NativePlaybackIdentity = {
  owner: NativePlaybackOwner;
  generation: number;
  channelKey: string;
};

export type NativePlaybackTrack = {
  groupIndex: number;
  trackIndex: number;
  id: string;
  name: string;
  language?: string | null;
  mimeType?: string | null;
  isSupported?: boolean;
};

export type NativePlaybackSourceRefreshRequest = NativePlaybackIdentity & {
  requestId: number;
  recoveryAttempt: number;
  reason: string;
  authenticationFailure: boolean;
};

export type NativePlaybackDiagnostic = NativePlaybackIdentity & {
  event: string;
  media3ErrorCode?: number | null;
  media3ErrorCodeName?: string | null;
  httpResponseCode?: number | null;
  exceptionType?: string | null;
  errorSummary?: string | null;
  causeChain: string;
  playbackState: string;
  bufferedDurationMs: number;
  bufferedPositionMs: number;
  positionMs: number;
  contentType?: string | null;
  sourceType?: string | null;
  detectedContainer?: string | null;
  detectedMimeType?: string | null;
  resolvedUri?: string | null;
  probeHttpResponseCode?: number | null;
  probeReason?: string | null;
  videoMimeType?: string | null;
  videoCodecs?: string | null;
  audioMimeType?: string | null;
  audioCodecs?: string | null;
  videoWidth?: number | null;
  videoHeight?: number | null;
  videoDecoder?: string | null;
  audioDecoder?: string | null;
  codecError?: string | null;
  recoveryAttempt: number;
  lowRam: boolean;
  heapUsedBytes: number;
  heapMaxBytes: number;
  epgRam: Record<string, number>;
};

type NativePlaybackModuleShape = {
  prepareFullscreen(generation: number, channelKey: string, uri: string, headers: Record<string, string>, contentType?: string | null): void;
  preparePreview(generation: number, channelKey: string, uri: string, headers: Record<string, string>, contentType?: string | null): void;
  resolveFreshSource(requestId: number, uri?: string | null, headers?: Record<string, string>, contentType?: string | null, failureReason?: string | null): void;
  setResizeMode(mode?: string | null): void;
  pause(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  selectAudio(groupIndex: number, trackIndex: number): void;
  selectAudioLanguage(language?: string | null): void;
  selectSubtitle(groupIndex: number, trackIndex: number): void;
  selectSubtitleLanguage(language?: string | null): void;
  subtitlesOff(): void;
  stopPreview(): Promise<void>;
  stopFullscreen(releasePlayer: boolean): Promise<void>;
  getOwner(): Promise<NativePlaybackOwner>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const native: NativePlaybackModuleShape | null =
  Platform.OS === "android" ? (NativeModules.NativePlayback as NativePlaybackModuleShape | undefined) ?? null : null;
const emitter = native ? new NativeEventEmitter(NativeModules.NativePlayback) : null;

export function nativePlaybackAvailable(): boolean { return !!native; }
export function prepareNativeFullscreen(generation: number, channelKey: string, uri: string, headers: Record<string, string>, contentType?: string | null): void { native?.prepareFullscreen(generation, channelKey, uri, headers, contentType ?? null); }
export function prepareNativePreview(generation: number, channelKey: string, uri: string, headers: Record<string, string>, contentType?: string | null): void { native?.preparePreview(generation, channelKey, uri, headers, contentType ?? null); }
export function resolveNativePlaybackFreshSource(requestId: number, uri?: string | null, headers: Record<string, string> = {}, contentType?: string | null, failureReason?: string | null): void { native?.resolveFreshSource(requestId, uri ?? null, headers, contentType ?? null, failureReason ?? null); }
export function setNativePlaybackResizeMode(mode: "fit" | "zoom" | "stretch"): void { native?.setResizeMode(mode); }
export function pauseNativePlayback(): void { native?.pause(); }
export function resumeNativePlayback(): void { native?.resume(); }
export function setNativePlaybackMuted(muted: boolean): void { native?.setMuted(muted); }

export function selectNativeAudio(track?: NativePlaybackTrack | null, language?: string | null): void {
  if (track) native?.selectAudio(track.groupIndex, track.trackIndex); else native?.selectAudioLanguage(language ?? null);
}
export function selectNativeSubtitle(track?: NativePlaybackTrack | null, language?: string | null): void {
  if (track) native?.selectSubtitle(track.groupIndex, track.trackIndex); else if (language) native?.selectSubtitleLanguage(language); else native?.subtitlesOff();
}
export async function stopNativePreview(): Promise<void> { await native?.stopPreview(); }
export async function stopNativeFullscreen(releasePlayer = true): Promise<void> { await native?.stopFullscreen(releasePlayer); }
export async function getNativePlaybackOwner(): Promise<NativePlaybackOwner> { return (await native?.getOwner()) ?? "none"; }
export function addNativePlaybackStateListener(listener: (event: NativePlaybackIdentity & { state: NativePlaybackState; reason?: string | null }) => void): () => void { const sub = emitter?.addListener("NativePlaybackState", listener); return () => sub?.remove(); }
export function addNativePlaybackTracksListener(listener: (event: NativePlaybackIdentity & { audio: NativePlaybackTrack[]; text: NativePlaybackTrack[] }) => void): () => void { const sub = emitter?.addListener("NativePlaybackTracks", listener); return () => sub?.remove(); }
export function addNativePlaybackSourceRefreshListener(listener: (event: NativePlaybackSourceRefreshRequest) => void): () => void { const sub = emitter?.addListener("NativePlaybackSourceRefreshRequested", listener); return () => sub?.remove(); }
export function addNativePlaybackDiagnosticListener(listener: (event: NativePlaybackDiagnostic) => void): () => void { const sub = emitter?.addListener("NativePlaybackDiagnostics", listener); return () => sub?.remove(); }
''')

write("frontend/android/app/src/main/java/com/charmiptv/app/NativePlaybackModule.kt", r'''package com.charmiptv.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class NativePlaybackModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx),
  NativePlaybackManager.Listener,
  LifecycleEventListener {

  private var activeOwner = NativePlaybackManager.Owner.NONE
  private var activeGeneration = 0L
  private var activeChannelKey = ""

  override fun getName(): String = "NativePlayback"

  init {
    NativePlaybackManager.setListener(this)
    ctx.addLifecycleEventListener(this)
  }

  @ReactMethod
  fun prepareFullscreen(generation: Double, channelKey: String?, uri: String, headers: ReadableMap?, contentType: String?) {
    attachActivity()
    setIdentity(NativePlaybackManager.Owner.FULLSCREEN, generation.toLong(), channelKey.orEmpty())
    NativePlaybackManager.prepare(NativePlaybackManager.Owner.FULLSCREEN, activeChannelKey, uri, readableMapToStringMap(headers), contentType)
  }

  @ReactMethod
  fun preparePreview(generation: Double, channelKey: String?, uri: String, headers: ReadableMap?, contentType: String?) {
    attachActivity()
    if (NativePlaybackManager.currentOwner() == NativePlaybackManager.Owner.FULLSCREEN) return
    setIdentity(NativePlaybackManager.Owner.PREVIEW, generation.toLong(), channelKey.orEmpty())
    NativePlaybackManager.prepare(NativePlaybackManager.Owner.PREVIEW, activeChannelKey, uri, readableMapToStringMap(headers), contentType)
  }

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
    val event = identityMap().apply {
      putString("state", state)
      if (reason != null) putString("reason", reason)
    }
    emit("NativePlaybackState", event)
  }

  override fun onTracks(audio: List<NativePlaybackManager.AudioTrackInfo>, subtitles: List<NativePlaybackManager.SubtitleTrackInfo>) {
    val audioArray = Arguments.createArray()
    audio.forEach { track -> audioArray.pushMap(Arguments.createMap().apply { putInt("groupIndex", track.groupIndex); putInt("trackIndex", track.trackIndex); putString("id", track.id); putString("name", track.label); putString("language", track.language); putString("mimeType", track.mimeType); putBoolean("isSupported", track.supported) }) }
    val textArray = Arguments.createArray()
    subtitles.forEach { track -> textArray.pushMap(Arguments.createMap().apply { putInt("groupIndex", track.groupIndex); putInt("trackIndex", track.trackIndex); putString("id", track.id); putString("name", track.label); putString("language", track.language) }) }
    emit("NativePlaybackTracks", identityMap().apply { putArray("audio", audioArray); putArray("text", textArray) })
  }

  override fun onSourceRefreshRequested(request: NativePlaybackManager.SourceRefreshRequest) {
    val generation = if (request.owner == activeOwner && request.channelKey == activeChannelKey) activeGeneration else -1L
    emit("NativePlaybackSourceRefreshRequested", Arguments.createMap().apply {
      putDouble("requestId", request.requestId.toDouble())
      putString("owner", request.owner.name.lowercase())
      putDouble("generation", generation.toDouble())
      putString("channelKey", request.channelKey)
      putInt("recoveryAttempt", request.recoveryAttempt)
      putString("reason", request.reason)
      putBoolean("authenticationFailure", request.authenticationFailure)
    })
  }

  override fun onDiagnostic(diagnostic: NativePlaybackManager.PlaybackDiagnostic) {
    val epg = Arguments.createMap()
    diagnostic.epgRamStats.forEach { (key, value) -> epg.putDouble(key, value.toDouble()) }
    val diagnosticChannel = diagnostic.channelKey.orEmpty()
    val generation = if (diagnosticChannel == activeChannelKey) activeGeneration else -1L
    emit("NativePlaybackDiagnostics", Arguments.createMap().apply {
      putString("owner", activeOwner.name.lowercase())
      putDouble("generation", generation.toDouble())
      putString("channelKey", diagnosticChannel)
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

  override fun onHostResume() = Unit
  override fun onHostPause() { NativePlaybackManager.pause() }
  override fun onHostDestroy() { NativePlaybackManager.releaseAll(); clearIdentity() }

  override fun invalidate() {
    try { ctx.removeLifecycleEventListener(this) } catch (_: Throwable) {}
    NativePlaybackManager.setListener(null)
    NativePlaybackManager.releaseAll()
    clearIdentity()
    super.invalidate()
  }

  private fun stopOwner(requestedOwner: NativePlaybackManager.Owner, releasePlayer: Boolean, promise: Promise) {
    val activity = ctx.currentActivity
    val stop = {
      NativePlaybackManager.stop(requestedOwner, releasePlayer) {
        if (activeOwner == requestedOwner) clearIdentity()
        promise.resolve(null)
      }
    }
    if (activity == null) stop() else activity.runOnUiThread(stop)
  }

  private fun setIdentity(owner: NativePlaybackManager.Owner, generation: Long, channelKey: String) {
    activeOwner = owner
    activeGeneration = generation
    activeChannelKey = channelKey.trim()
  }

  private fun clearIdentity() {
    activeOwner = NativePlaybackManager.Owner.NONE
    activeGeneration = 0L
    activeChannelKey = ""
  }

  private fun identityMap() = Arguments.createMap().apply {
    putString("owner", activeOwner.name.lowercase())
    putDouble("generation", activeGeneration.toDouble())
    putString("channelKey", activeChannelKey)
  }

  private fun attachActivity() { ctx.currentActivity?.let(NativePlaybackManager::installIntoActivity) }
  private fun emit(name: String, value: Any) { try { ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value) } catch (_: Throwable) {} }
  private fun readableMapToStringMap(readable: ReadableMap?): Map<String, String> {
    if (readable == null) return emptyMap()
    val out = LinkedHashMap<String, String>()
    val iterator = readable.keySetIterator()
    while (iterator.hasNextKey()) {
      val key = iterator.nextKey()
      try { val value = readable.getString(key); if (!value.isNullOrBlank()) out[key] = value } catch (_: Throwable) {}
    }
    return out
  }
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit
}
''')

write("frontend/src/components/StreamPlayer.tsx", r'''import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, requireNativeComponent, StyleProp, View, ViewProps, ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import {
  detectStreamKind,
  isNativeMedia3SupportedStreamKind,
  isVlcSupportedStreamKind,
  media3ContentType,
  parsePipeHeaders,
} from "@/src/core/streamPolicy";
import {
  beginSession,
  getPlaybackOwnershipRevision,
  isPreviewPlaybackAllowed,
  isSessionCurrent,
  setNativePlaybackPauseHandler,
  setNativePlaybackReleaseHandler,
  setSessionPhase,
  stopFullscreenSession,
  stopPreviewSession,
  subscribePlaybackOwnership,
  type SessionFailReason,
  type SessionRole,
} from "@/src/core/playbackSession";
import {
  addNativePlaybackDiagnosticListener,
  addNativePlaybackStateListener,
  addNativePlaybackSourceRefreshListener,
  addNativePlaybackTracksListener,
  nativePlaybackAvailable,
  pauseNativePlayback,
  prepareNativeFullscreen,
  prepareNativePreview,
  resolveNativePlaybackFreshSource,
  resumeNativePlayback,
  selectNativeAudio,
  selectNativeSubtitle,
  setNativePlaybackMuted,
  setNativePlaybackResizeMode,
  stopNativeFullscreen,
  stopNativePreview,
  type NativePlaybackTrack,
} from "@/src/nativePlayback";
import {
  addNativeVlcStateListener,
  addNativeVlcTracksListener,
  nativeVlcPlaybackAvailable,
  pauseNativeVlcPlayback,
  prepareNativeVlcFullscreen,
  prepareNativeVlcPreview,
  resumeNativeVlcPlayback,
  selectNativeVlcAudio,
  selectNativeVlcSubtitle,
  setNativeVlcMuted,
  setNativeVlcResizeMode,
  stopNativeVlcFullscreen,
  stopNativeVlcPreview,
} from "@/src/nativeVlcPlayback";
import { usePlayerEnginePreference } from "@/src/playerEnginePreference";
import { useVlcPlaybackPreferences } from "@/src/core/vlcPlaybackPreferences";
import {
  invalidateConfirmedStreamType,
  rememberConfirmedStreamType,
  rememberDeclaredStreamType,
  rememberPlaybackEngine,
  useChannelPlaybackProfile,
} from "@/src/core/playbackProfileIndex";
import { getPreferredAudioLanguage, getRememberedChannelAudioTrack } from "@/src/core/audioTrackPreferences";
import type { PlaybackBufferProfile } from "@/src/core/playbackBufferProfile";
import { setNativePlaybackStarting } from "@/src/utils/tvRemote";
import { refreshPlaybackChannel } from "@/src/source";

export type StreamStatus = "loading" | "playing" | "error";
export type PlayerScaleMode = "fit" | "zoom" | "stretch";
export type StreamTrack = { id: string | number; name: string; mimeType?: string | null; isSupported?: boolean };

type NativePlaybackSurfaceProps = ViewProps & { owner: "preview" | "fullscreen" };
const NativePlaybackSurface = requireNativeComponent<NativePlaybackSurfaceProps>("CharmNativePlaybackSurface");
const NativeVlcPlaybackSurface = requireNativeComponent<NativePlaybackSurfaceProps>("CharmNativeVlcPlaybackSurface");

// One ownership gate controls both engines. Fullscreen teardown releases both
// native cores; preview teardown releases the active decoder while allowing the
// selected engine's core to stay warm for fast Guide→fullscreen handoff.
setNativePlaybackReleaseHandler(async (role) => {
  if (role === "preview") {
    await Promise.allSettled([stopNativePreview(), stopNativeVlcPreview(false)]);
  } else {
    await Promise.allSettled([stopNativeFullscreen(true), stopNativeVlcFullscreen(true)]);
  }
});
setNativePlaybackPauseHandler((role) => {
  if (role !== "fullscreen") return;
  pauseNativePlayback();
  pauseNativeVlcPlayback();
});

type Props = {
  uri: string;
  channelKey?: string;
  streamTypeHint?: string | null;
  onStatus: (s: StreamStatus, reason?: SessionFailReason | null) => void;
  style?: StyleProp<ViewStyle>;
  mode?: "preview" | "full";
  sessionRole?: SessionRole;
  muted?: boolean;
  audioTrack?: string | number;
  textTrack?: string | number | null;
  onTracksAvailable?: (tracks: { audio: StreamTrack[]; text: StreamTrack[] }) => void;
  bufferProfile?: PlaybackBufferProfile;
  paused?: boolean;
  scaleMode?: PlayerScaleMode;
};

function profileType(kind: ReturnType<typeof detectStreamKind>): "hls" | "dash" | "transport" | "progressive" | "unknown" {
  return kind === "hls" || kind === "dash" || kind === "transport" || kind === "progressive" ? kind : "unknown";
}

export function StreamPlayer({
  uri: rawUri,
  channelKey,
  streamTypeHint,
  onStatus,
  style,
  mode = "full",
  sessionRole,
  muted = false,
  audioTrack,
  textTrack,
  onTracksAvailable,
  bufferProfile,
  paused = false,
  scaleMode = "fit",
}: Props) {
  const role: SessionRole = sessionRole ?? (mode === "preview" ? "preview" : "fullscreen");
  const owner = role === "preview" ? "preview" : "fullscreen";
  const currentChannelKey = String(channelKey || "").trim();
  const isFocused = useIsFocused();
  useSyncExternalStore(subscribePlaybackOwnership, getPlaybackOwnershipRevision, getPlaybackOwnershipRevision);
  const previewAllowed = role !== "preview" || isPreviewPlaybackAllowed();
  const [appActive, setAppActive] = useState(() => AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const playbackFocused = isFocused && appActive && previewAllowed;
  const [playerEngine] = usePlayerEnginePreference();
  const vlcPrefs = useVlcPlaybackPreferences();
  const profile = useChannelPlaybackProfile(currentChannelKey);
  const generationRef = useRef(0);
  const tracksRef = useRef<{ audio: NativePlaybackTrack[]; text: NativePlaybackTrack[] }>({ audio: [], text: [] });
  const onStatusRef = useRef(onStatus);
  const onTracksRef = useRef(onTracksAvailable);
  onStatusRef.current = onStatus;
  onTracksRef.current = onTracksAvailable;

  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const declaredKind = useMemo(() => detectStreamKind(uri, streamTypeHint), [streamTypeHint, uri]);
  const learnedHint = profile?.confirmedType ?? streamTypeHint;
  const kind = useMemo(() => detectStreamKind(uri, learnedHint), [learnedHint, uri]);
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const effectiveBufferProfile: PlaybackBufferProfile = bufferProfile ?? "balanced";
  const currentSourceRef = useRef({ uri, headers, contentType, streamTypeHint });
  currentSourceRef.current = { uri, headers, contentType, streamTypeHint };

  useEffect(() => {
    rememberDeclaredStreamType(currentChannelKey, profileType(declaredKind));
  }, [currentChannelKey, declaredKind]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state !== "background" && state !== "inactive"));
    return () => sub.remove();
  }, []);

  useEffect(() => addNativePlaybackStateListener((event) => {
    if (playerEngine !== "media3") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey || !isSessionCurrent(role, generation)) return;
    if (event.state === "playing") {
      rememberPlaybackEngine(currentChannelKey, "media3");
      setSessionPhase(role, generation, "playing");
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("playing", null);
    } else if (event.state === "loading") {
      setSessionPhase(role, generation, event.reason === "native-reprepare" ? "recovering" : "preparing", null);
      onStatusRef.current("loading", null);
    } else {
      const reason: SessionFailReason = event.reason === "start-timeout" ? "start-timeout" : "stream-error";
      setSessionPhase(role, generation, "failed", reason);
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("error", reason);
    }
  }), [currentChannelKey, owner, playerEngine, role]);

  useEffect(() => addNativeVlcStateListener((event) => {
    if (playerEngine !== "vlc") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey || !isSessionCurrent(role, generation)) return;
    if (event.state === "playing") {
      rememberPlaybackEngine(currentChannelKey, "vlc");
      setSessionPhase(role, generation, "playing");
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("playing", null);
    } else if (event.state === "loading") {
      setSessionPhase(role, generation, "preparing", null);
      onStatusRef.current("loading", null);
    } else {
      setSessionPhase(role, generation, "failed", "stream-error");
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("error", "stream-error");
    }
  }), [currentChannelKey, owner, playerEngine, role]);

  useEffect(() => addNativePlaybackDiagnosticListener((event) => {
    if (playerEngine !== "media3") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey) return;
    if (event.event === "opaque-cache-invalidated") invalidateConfirmedStreamType(currentChannelKey);
    if (event.event === "opaque-type-stable" && event.sourceType) rememberConfirmedStreamType(currentChannelKey, event.sourceType, "media3");
  }), [currentChannelKey, owner, playerEngine]);

  useEffect(() => addNativePlaybackSourceRefreshListener((event) => {
    if (playerEngine !== "media3") return;
    const generation = generationRef.current;
    if (event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey || !generation || !isSessionCurrent(role, generation)) {
      resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session");
      return;
    }
    const current = currentSourceRef.current;
    void refreshPlaybackChannel(event.channelKey)
      .then((channel) => {
        if (!isSessionCurrent(role, generation)) {
          resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session");
          return;
        }
        if (!channel?.url) {
          resolveNativePlaybackFreshSource(event.requestId, current.uri, current.headers, current.contentType, "fresh-channel-unavailable-reused-current");
          return;
        }
        const fresh = parsePipeHeaders(channel.url);
        const freshType = media3ContentType(detectStreamKind(fresh.uri, channel.stream_type));
        resolveNativePlaybackFreshSource(event.requestId, fresh.uri, fresh.headers, freshType, null);
      })
      .catch((error: unknown) => {
        if (!isSessionCurrent(role, generation)) {
          resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session");
          return;
        }
        const message = error instanceof Error ? error.name : "source-refresh-failed";
        resolveNativePlaybackFreshSource(event.requestId, current.uri, current.headers, current.contentType, `${message}-reused-current`);
      });
  }), [currentChannelKey, owner, playerEngine, role]);

  useEffect(() => addNativePlaybackTracksListener((event) => {
    if (playerEngine !== "media3") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey) return;
    tracksRef.current = { audio: event.audio, text: event.text };
    onTracksRef.current?.({
      audio: event.audio.map((track) => ({ id: track.id, name: track.name, mimeType: track.mimeType, isSupported: track.isSupported })),
      text: event.text.map((track) => ({ id: track.id, name: track.name })),
    });
    const remembered = audioTrack ?? getRememberedChannelAudioTrack(currentChannelKey);
    const selectedAudio = remembered == null ? null : event.audio.find((track) => String(track.id) === String(remembered)) ?? null;
    selectNativeAudio(selectedAudio, selectedAudio ? null : getPreferredAudioLanguage());
    if (textTrack == null) selectNativeSubtitle(null, null);
    else selectNativeSubtitle(event.text.find((track) => String(track.id) === String(textTrack)) ?? null, null);
  }), [audioTrack, currentChannelKey, owner, playerEngine, textTrack]);

  useEffect(() => addNativeVlcTracksListener((event) => {
    if (playerEngine !== "vlc") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey) return;
    tracksRef.current = { audio: event.audio, text: event.text };
    onTracksRef.current?.({
      audio: event.audio.map((track) => ({ id: track.id, name: track.name, isSupported: true })),
      text: event.text.map((track) => ({ id: track.id, name: track.name })),
    });
    const remembered = audioTrack ?? getRememberedChannelAudioTrack(currentChannelKey);
    if (remembered != null) selectNativeVlcAudio(event.audio.find((track) => String(track.id) === String(remembered)) ?? null);
    if (textTrack == null) selectNativeVlcSubtitle(null);
    else selectNativeVlcSubtitle(event.text.find((track) => String(track.id) === String(textTrack)) ?? null);
  }), [audioTrack, currentChannelKey, owner, playerEngine, textTrack]);

  useEffect(() => () => {
    if (role === "preview") void stopPreviewSession("superseded");
  }, [role]);

  useEffect(() => {
    const media3Available = Platform.OS === "android" && nativePlaybackAvailable();
    const vlcAvailable = Platform.OS === "android" && nativeVlcPlaybackAvailable();
    const engineAvailable = playerEngine === "vlc" ? vlcAvailable : media3Available;
    const kindSupported = playerEngine === "vlc" ? isVlcSupportedStreamKind(kind) : isNativeMedia3SupportedStreamKind(kind);

    if (!playbackFocused || !uri || !engineAvailable) {
      generationRef.current = 0;
      if (role === "preview") void stopPreviewSession("superseded");
      else if (!appActive) void stopFullscreenSession();
      if (playbackFocused && uri && !engineAvailable) onStatusRef.current("error", "stream-error");
      return;
    }
    if (!kindSupported) {
      generationRef.current = 0;
      onStatusRef.current("error", "stream-error");
      return;
    }

    const generation = beginSession(role);
    generationRef.current = generation;
    if (!generation) return;
    let cancelled = false;
    setSessionPhase(role, generation, "preparing");
    if (role === "fullscreen") setNativePlaybackStarting(true);
    onStatusRef.current("loading", null);

    void (async () => {
      if (playerEngine === "vlc") {
        if (role === "preview") await stopNativePreview(); else await stopNativeFullscreen(true);
        if (cancelled || !isSessionCurrent(role, generation)) return;
        if (role === "preview") {
          prepareNativeVlcPreview(generation, currentChannelKey, uri, headers, vlcPrefs.hardwareDecode, vlcPrefs.audioOutput, effectiveBufferProfile);
        } else {
          prepareNativeVlcFullscreen(generation, currentChannelKey, uri, headers, vlcPrefs.hardwareDecode, vlcPrefs.audioOutput, effectiveBufferProfile);
        }
      } else {
        if (role === "preview") await stopNativeVlcPreview(true); else await stopNativeVlcFullscreen(true);
        if (cancelled || !isSessionCurrent(role, generation)) return;
        if (role === "preview") prepareNativePreview(generation, currentChannelKey, uri, headers, contentType);
        else prepareNativeFullscreen(generation, currentChannelKey, uri, headers, contentType);
      }
    })();

    return () => {
      cancelled = true;
      if (generationRef.current === generation) generationRef.current = 0;
    };
  }, [
    appActive,
    contentType,
    currentChannelKey,
    effectiveBufferProfile,
    headers,
    isFocused,
    kind,
    playbackFocused,
    playerEngine,
    role,
    uri,
    vlcPrefs.audioOutput,
    vlcPrefs.hardwareDecode,
  ]);

  useEffect(() => {
    if (playerEngine === "vlc") setNativeVlcMuted(muted); else setNativePlaybackMuted(muted);
  }, [muted, playerEngine]);
  useEffect(() => {
    if (playerEngine === "vlc") {
      if (paused) pauseNativeVlcPlayback(); else if (playbackFocused) resumeNativeVlcPlayback();
    } else {
      if (paused) pauseNativePlayback(); else if (playbackFocused) resumeNativePlayback();
    }
  }, [paused, playbackFocused, playerEngine]);
  useEffect(() => {
    if (role !== "fullscreen") return;
    if (playerEngine === "vlc") setNativeVlcResizeMode(scaleMode); else setNativePlaybackResizeMode(scaleMode);
  }, [playerEngine, role, scaleMode]);

  useEffect(() => {
    if (audioTrack == null) return;
    const selected = tracksRef.current.audio.find((track) => String(track.id) === String(audioTrack)) ?? null;
    if (playerEngine === "vlc") selectNativeVlcAudio(selected); else selectNativeAudio(selected, null);
  }, [audioTrack, playerEngine]);
  useEffect(() => {
    const selected = textTrack == null ? null : tracksRef.current.text.find((track) => String(track.id) === String(textTrack)) ?? null;
    if (playerEngine === "vlc") selectNativeVlcSubtitle(selected); else if (textTrack == null) selectNativeSubtitle(null, null); else selectNativeSubtitle(selected, null);
  }, [playerEngine, textTrack]);

  if (!playbackFocused || !uri) return null;
  if (Platform.OS !== "android") return <View pointerEvents="none" collapsable={false} style={style} />;
  if (playerEngine === "vlc") {
    if (!nativeVlcPlaybackAvailable()) return <View pointerEvents="none" collapsable={false} style={style} />;
    return <NativeVlcPlaybackSurface owner={owner} pointerEvents="none" collapsable={false} style={style} />;
  }
  if (!nativePlaybackAvailable()) return <View pointerEvents="none" collapsable={false} style={style} />;
  return <NativePlaybackSurface owner={owner} pointerEvents="none" collapsable={false} style={style} />;
}
''')

# Settings: expose only an explicit manual engine selector, then VLC-specific
# compatibility knobs. No Auto option means no cross-engine recovery loop.
settings = "frontend/app/(tabs)/settings.tsx"
replace_once(
    settings,
    'import { PREFERRED_AUDIO_LANGUAGE_OPTIONS } from "@/src/core/preferredAudioLanguages";\n',
    'import { PREFERRED_AUDIO_LANGUAGE_OPTIONS } from "@/src/core/preferredAudioLanguages";\nimport { usePlayerEnginePreference, type PlayerEnginePreference } from "@/src/playerEnginePreference";\nimport { useVlcPlaybackPreferences, type VlcAudioOutput } from "@/src/core/vlcPlaybackPreferences";\n',
)
replace_once(
    settings,
    '  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();\n',
    '  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();\n  const [playerEngine, setPlayerEngine] = usePlayerEnginePreference();\n  const vlcPlayback = useVlcPlaybackPreferences();\n',
)
replace_once(
    settings,
    '''                <Text style={styles.settingLabel}>Media3 live TV</Text>\n                <Text style={styles.help}>\n                  Live TV uses one Android-owned Media3 player. It starts with supported hardware codecs and uses the installed Media3 audio fallback when available; no second engine is started automatically.\n                </Text>\n''',
    '''                <Text style={styles.settingLabel}>Playback engine</Text>\n                <ChoiceRow<PlayerEnginePreference>\n                  label="Engine"\n                  value={playerEngine}\n                  options={[\n                    { label: "Media3 (Recommended)", value: "media3" },\n                    { label: "VLC (Compatibility)", value: "vlc" },\n                  ]}\n                  onChange={setPlayerEngine}\n                />\n                <Text style={styles.help}>\n                  Only the selected engine owns a decoder. Switching engines fully releases the other engine first; there is no automatic Media3↔VLC fallback loop.\n                </Text>\n                {playerEngine === "vlc" ? (\n                  <>\n                    <ToggleRow label="VLC hardware decoding" value={vlcPlayback.hardwareDecode} onChange={vlcPlayback.setHardwareDecode} />\n                    <ChoiceRow<VlcAudioOutput>\n                      label="VLC audio output"\n                      value={vlcPlayback.audioOutput}\n                      options={[\n                        { label: "Auto", value: "auto" },\n                        { label: "Stereo / 2-channel", value: "stereo" },\n                        { label: "Passthrough", value: "passthrough" },\n                      ]}\n                      onChange={vlcPlayback.setAudioOutput}\n                    />\n                    <Text style={styles.help}>Disable VLC hardware decoding only for a channel/device that needs software compatibility; hardware stays the default for TV sticks and boxes.</Text>\n                  </>\n                ) : (\n                  <Text style={styles.help}>Media3 keeps the locked live-TV buffer/recovery budgets and bundled FFmpeg audio fallback.</Text>\n                )}\n''',
)
replace_once(
    settings,
    '                  Preferred audio language auto-selects a matching native Media3 track.\n',
    '                  Preferred audio language auto-selects a matching track when the selected engine exposes language metadata.\n',
)

# Wire the regression test into the suite.
run_tests = "frontend/tests/run-tests.mjs"
text = read(run_tests)
if 'import "./manualVlcEngine.test.mjs";' not in text:
    if not text.endswith("\n"):
        text += "\n"
    text += 'import "./manualVlcEngine.test.mjs";\n'
    write(run_tests, text)

print("manual VLC/profile patch applied")
