import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, requireNativeComponent, StyleProp, View, ViewProps, ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import {
  detectStreamKind,
  fallbackEngine,
  initialEngine,
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
  stopPreviewSession,
  subscribePlaybackOwnership,
  type SessionFailReason,
  type SessionRole,
} from "@/src/core/playbackSession";
import {
  activateNativePlaybackEngine,
  pauseActiveNativePlayback,
  releaseNativePlaybackRole,
  runNativePlaybackCommand,
} from "@/src/core/nativePlaybackCoordinator";
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
import { fingerprintStreamUri, recordAudioDiagnostics } from "@/src/core/audioDiagnostics";

export type StreamStatus = "loading" | "playing" | "error";
export type PlayerScaleMode = "fit" | "fill" | "zoom" | "stretch";
export type StreamTrack = { id: string | number; name: string; mimeType?: string | null; isSupported?: boolean };

type NativePlaybackSurfaceProps = ViewProps & { owner: "preview" | "fullscreen" };
const NativePlaybackSurface = requireNativeComponent<NativePlaybackSurfaceProps>("CharmNativePlaybackSurface");
const NativeVlcPlaybackSurface = requireNativeComponent<NativePlaybackSurfaceProps>("CharmNativeVlcPlaybackSurface");

// A single serialized coordinator owns all native engine transitions. It waits
// for the old decoder to release before the next engine may prepare.
setNativePlaybackReleaseHandler(releaseNativePlaybackRole);
setNativePlaybackPauseHandler(pauseActiveNativePlayback);

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
  bufferProfile = "stable",
  paused = false,
  scaleMode = "fit",
}: Props) {
  const role: SessionRole = sessionRole ?? (mode === "preview" ? "preview" : "fullscreen");
  const owner = role === "preview" ? "preview" : "fullscreen";
  const currentChannelKey = String(channelKey || "").trim();
  const isFocused = useIsFocused();
  const [playerEngine] = usePlayerEnginePreference();
  const vlcPrefs = useVlcPlaybackPreferences();
  const profile = useChannelPlaybackProfile(currentChannelKey);
  useSyncExternalStore(subscribePlaybackOwnership, getPlaybackOwnershipRevision, getPlaybackOwnershipRevision);
  const previewAllowed = role !== "preview" || isPreviewPlaybackAllowed();
  // Android TV fires AppState "inactive" for overlays / focus blips without
  // leaving the player. Treating inactive as dead tore down both Media3 and
  // VLC (unmount surface + stopFullscreen) → permanent black+silent.
  const [appActive, setAppActive] = useState(() => AppState.currentState !== "background");
  const appInForeground = appActive;
  // Preview still requires Guide focus. Fullscreen must keep the decoder host
  // mounted while the player route owns the channel — do not destroy on
  // transient isFocused=false flickers once a session has started.
  const playbackFocused =
    role === "fullscreen"
      ? appInForeground && previewAllowed
      : isFocused && appInForeground && previewAllowed;
  const generationRef = useRef(0);
  const tracksRef = useRef<{ audio: NativePlaybackTrack[]; text: NativePlaybackTrack[] }>({ audio: [], text: [] });
  const onStatusRef = useRef(onStatus);
  const onTracksRef = useRef(onTracksAvailable);
  onStatusRef.current = onStatus;
  onTracksRef.current = onTracksAvailable;

  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const declaredKind = useMemo(() => detectStreamKind(uri, streamTypeHint), [streamTypeHint, uri]);
  // Extensionless live IPTV must not lock Media3 to a prior confirm. A wrong
  // progressive/hls/dash/transport confirm skips or stalls the opaque router →
  // black+silent. Prefer playlist hint only; native owns classification.
  const learnedHint = useMemo(() => {
    const uriKind = detectStreamKind(uri, null);
    if (uriKind === "unknown") {
      const hint = String(streamTypeHint || "").trim().toLowerCase();
      // Ignore progressive confirms on extensionless live URLs (no live-TS flags).
      if (!hint || hint === "unknown" || hint === "progressive" || profile?.confirmedType === "progressive") {
        return "unknown";
      }
      return hint;
    }
    return profile?.confirmedType ?? streamTypeHint;
  }, [profile?.confirmedType, streamTypeHint, uri]);
  const kind = useMemo(() => detectStreamKind(uri, learnedHint), [learnedHint, uri]);
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const playbackKey = useMemo(
    () => `${playerEngine}\u0000${currentChannelKey}\u0000${rawUri}`,
    [currentChannelKey, playerEngine, rawUri],
  );
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const engine = fallbackKey === playbackKey ? "vlc" : initialEngine(playerEngine, kind);
  const fallbackInFlightRef = useRef<string | null>(null);
  const controlRef = useRef({ muted, paused, scaleMode });
  controlRef.current = { muted, paused, scaleMode };
  // VLC settings must not rebuild a healthy Media3 session.
  const vlcHardwareDecode = engine === "vlc" ? vlcPrefs.hardwareDecode : true;
  const vlcAudioOutput = engine === "vlc" ? vlcPrefs.audioOutput : "auto";
  const currentSourceRef = useRef({ key: playbackKey, uri, headers, contentType });
  // A native authentication refresh must survive renders and engine fallback.
  // Only an explicit source/tune change may replace the refreshed provider URL.
  if (currentSourceRef.current.key !== playbackKey) {
    currentSourceRef.current = { key: playbackKey, uri, headers, contentType };
  }

  useEffect(() => {
    if (fallbackKey && fallbackKey !== playbackKey) setFallbackKey(null);
    if (fallbackInFlightRef.current && fallbackInFlightRef.current !== playbackKey) {
      fallbackInFlightRef.current = null;
    }
  }, [fallbackKey, playbackKey]);

  useEffect(() => {
    tracksRef.current = { audio: [], text: [] };
  }, [engine, playbackKey]);

  const tryAutomaticVlcFallback = useCallback((generation: number, reason: SessionFailReason): boolean => {
    if (fallbackEngine(playerEngine, "media3", kind) !== "vlc" || !nativeVlcPlaybackAvailable()) return false;
    if (fallbackKey === playbackKey || fallbackInFlightRef.current === playbackKey) return true;

    fallbackInFlightRef.current = playbackKey;
    invalidateConfirmedStreamType(currentChannelKey);
    setSessionPhase(role, generation, "recovering", reason);
    if (role === "fullscreen") setNativePlaybackStarting(true);
    onStatusRef.current("loading", null);

    // The prepare effect owns the queued release -> prepare transition.
    // Do not acquire VLC ahead of React committing its replacement surface.
    setFallbackKey(playbackKey);
    return true;
  }, [currentChannelKey, fallbackKey, kind, playbackKey, playerEngine, role]);

  useEffect(() => {
    rememberDeclaredStreamType(currentChannelKey, profileType(declaredKind));
  }, [currentChannelKey, declaredKind]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state !== "background"));
    return () => sub.remove();
  }, []);

  useEffect(() => addNativePlaybackStateListener((event) => {
    if (engine !== "media3") return;
    const generation = generationRef.current;
    if (
      !generation ||
      event.owner !== owner ||
      event.generation !== generation ||
      event.channelKey !== currentChannelKey ||
      !isSessionCurrent(role, generation)
    ) return;
    if (event.state === "playing") {
      rememberPlaybackEngine(currentChannelKey, "media3");
      setSessionPhase(role, generation, "playing");
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("playing", null);
    } else if (event.state === "loading") {
      setSessionPhase(role, generation, event.reason === "native-reprepare" ? "recovering" : "preparing", null);
      onStatusRef.current("loading", null);
    } else if (event.reason === "owner-reserved") {
      // Preview lost the single Media3 owner to fullscreen — not a stream failure.
      // Avoid Guide previewEpoch remount storms while fullscreen owns the decoder.
      onStatusRef.current("loading", null);
    } else {
      const reason: SessionFailReason = event.reason === "start-timeout" ? "start-timeout" : "stream-error";
      if (tryAutomaticVlcFallback(generation, reason)) return;
      setSessionPhase(role, generation, "failed", reason);
      if (role === "fullscreen") setNativePlaybackStarting(false);
      // Drop a wrong Media3 confirm so the next tune re-enters opaque routing.
      invalidateConfirmedStreamType(currentChannelKey);
      onStatusRef.current("error", reason);
    }
  }), [currentChannelKey, owner, engine, role, tryAutomaticVlcFallback]);

  useEffect(() => addNativeVlcStateListener((event) => {
    if (engine !== "vlc") return;
    const generation = generationRef.current;
    if (
      !generation ||
      event.owner !== owner ||
      event.generation !== generation ||
      event.channelKey !== currentChannelKey ||
      !isSessionCurrent(role, generation)
    ) return;
    if (event.state === "playing") {
      fallbackInFlightRef.current = null;
      rememberPlaybackEngine(currentChannelKey, "vlc");
      setSessionPhase(role, generation, "playing");
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("playing", null);
    } else if (event.state === "loading") {
      setSessionPhase(role, generation, "preparing", null);
      onStatusRef.current("loading", null);
    } else {
      const reason: SessionFailReason = event.reason === "request-headers-unsupported" ? "request-headers-unsupported" : "stream-error";
      setSessionPhase(role, generation, "failed", reason);
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("error", reason);
    }
  }), [currentChannelKey, owner, engine, role]);

  useEffect(() => addNativePlaybackDiagnosticListener((event) => {
    if (engine !== "media3") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey || !isSessionCurrent(role, generation)) return;
    if (event.event === "opaque-cache-invalidated") invalidateConfirmedStreamType(currentChannelKey);
    if (event.event === "opaque-type-stable" && event.sourceType) {
      rememberConfirmedStreamType(currentChannelKey, event.sourceType, "media3");
    }
    if (event.audioDecoder || event.audioMimeType) {
      const audioTracks = tracksRef.current.audio;
      const selected =
        audioTracks.find((track) => track.isSupported && track.mimeType === event.audioMimeType) ??
        audioTracks.find((track) => track.isSupported) ??
        audioTracks[0];
      recordAudioDiagnostics({
        engine: "media3",
        role,
        streamKey: fingerprintStreamUri(uri, kind),
        trackId: selected?.id ?? null,
        mimeType: event.audioMimeType ?? selected?.mimeType ?? null,
        decoder: event.audioDecoder ?? null,
        language: selected?.language ?? null,
        label: selected?.name ?? null,
        isSupported: selected?.isSupported ?? null,
        trackCount: audioTracks.length,
        supportedCount: audioTracks.filter((track) => track.isSupported).length,
        selectedBy: selected ? "current" : "none",
        reason: event.event,
      });
    }
  }), [currentChannelKey, owner, engine, kind, role, uri]);

  useEffect(() => addNativePlaybackSourceRefreshListener((event) => {
    if (engine !== "media3") return;
    const generation = generationRef.current;
    if (
      event.owner !== owner ||
      event.generation !== generation ||
      event.channelKey !== currentChannelKey ||
      !generation ||
      !isSessionCurrent(role, generation)
    ) return; // A mounted preview must never reject fullscreen's refresh request.
    const current = currentSourceRef.current;
    void refreshPlaybackChannel(event.channelKey)
      .then((channel) => {
        if (generationRef.current !== generation || !isSessionCurrent(role, generation)) {
          resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session");
          return;
        }
        if (!channel?.url) {
          resolveNativePlaybackFreshSource(event.requestId, current.uri, current.headers, current.contentType, "fresh-channel-unavailable-reused-current");
          return;
        }
        const fresh = parsePipeHeaders(channel.url);
        const freshType = media3ContentType(detectStreamKind(fresh.uri, channel.stream_type));
        currentSourceRef.current = { key: playbackKey, ...fresh, contentType: freshType };
        resolveNativePlaybackFreshSource(event.requestId, fresh.uri, fresh.headers, freshType, null);
      })
      .catch((error: unknown) => {
        if (generationRef.current !== generation || !isSessionCurrent(role, generation)) {
          resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session");
          return;
        }
        const message = error instanceof Error ? error.name : "source-refresh-failed";
        resolveNativePlaybackFreshSource(event.requestId, current.uri, current.headers, current.contentType, `${message}-reused-current`);
      });
  }), [currentChannelKey, owner, engine, playbackKey, role]);

  useEffect(() => addNativePlaybackTracksListener((event) => {
    if (engine !== "media3") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey || !isSessionCurrent(role, generation)) return;
    tracksRef.current = { audio: event.audio, text: event.text };
    onTracksRef.current?.({
      audio: event.audio.map((track) => ({ id: track.id, name: track.name, mimeType: track.mimeType, isSupported: track.isSupported })),
      text: event.text.map((track) => ({ id: track.id, name: track.name })),
    });
    const remembered = audioTrack ?? getRememberedChannelAudioTrack(currentChannelKey);
    const selectedAudio = remembered == null ? null : event.audio.find((track) => String(track.id) === String(remembered)) ?? null;
    void runNativePlaybackCommand(role, engine, () => isSessionCurrent(role, generation), () => {
      selectNativeAudio(selectedAudio, selectedAudio ? null : getPreferredAudioLanguage());
      if (textTrack == null) selectNativeSubtitle(null, null);
      else selectNativeSubtitle(event.text.find((track) => String(track.id) === String(textTrack)) ?? null, null);
    }).catch(() => undefined);
    const diagnosticAudio = selectedAudio ?? event.audio.find((track) => track.isSupported) ?? event.audio[0];
    recordAudioDiagnostics({
      engine: "media3",
      role,
      streamKey: fingerprintStreamUri(uri, kind),
      trackId: diagnosticAudio?.id ?? null,
      mimeType: diagnosticAudio?.mimeType ?? null,
      language: diagnosticAudio?.language ?? null,
      label: diagnosticAudio?.name ?? null,
      isSupported: diagnosticAudio?.isSupported ?? null,
      trackCount: event.audio.length,
      supportedCount: event.audio.filter((track) => track.isSupported).length,
      selectedBy: selectedAudio ? (audioTrack != null ? "user" : "current") : diagnosticAudio ? "auto-supported" : "none",
      reason: "tracks-changed",
    });
  }), [audioTrack, currentChannelKey, owner, engine, kind, role, textTrack, uri]);

  useEffect(() => addNativeVlcTracksListener((event) => {
    if (engine !== "vlc") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey || !isSessionCurrent(role, generation)) return;
    tracksRef.current = { audio: event.audio, text: event.text };
    onTracksRef.current?.({
      audio: event.audio.map((track) => ({ id: track.id, name: track.name, isSupported: true })),
      text: event.text.map((track) => ({ id: track.id, name: track.name })),
    });
    const remembered = audioTrack ?? getRememberedChannelAudioTrack(currentChannelKey);
    const selectedAudio = remembered == null ? null : event.audio.find((track) => String(track.id) === String(remembered)) ?? null;
    void runNativePlaybackCommand(role, engine, () => isSessionCurrent(role, generation), () => {
      if (remembered != null) selectNativeVlcAudio(selectedAudio);
      if (textTrack == null) selectNativeVlcSubtitle(null);
      else selectNativeVlcSubtitle(event.text.find((track) => String(track.id) === String(textTrack)) ?? null);
    }).catch(() => undefined);
    const diagnosticAudio = selectedAudio ?? event.audio[0];
    recordAudioDiagnostics({
      engine: "vlc",
      role,
      streamKey: fingerprintStreamUri(uri, kind),
      trackId: diagnosticAudio?.id ?? null,
      mimeType: diagnosticAudio?.mimeType ?? null,
      decoder: null,
      language: diagnosticAudio?.language ?? null,
      label: diagnosticAudio?.name ?? null,
      isSupported: diagnosticAudio ? true : null,
      trackCount: event.audio.length,
      supportedCount: event.audio.length,
      selectedBy: selectedAudio ? (audioTrack != null ? "user" : "current") : diagnosticAudio ? "auto-first" : "none",
      reason: "tracks-changed",
    });
  }), [audioTrack, currentChannelKey, owner, engine, kind, role, textTrack, uri]);

  useEffect(() => () => {
    if (role === "preview") void stopPreviewSession("superseded");
  }, [role]);

  useEffect(() => {
    const media3Available = Platform.OS === "android" && nativePlaybackAvailable();
    const vlcAvailable = Platform.OS === "android" && nativeVlcPlaybackAvailable();
    const engineAvailable = engine === "vlc" ? vlcAvailable : media3Available;
    const kindSupported = engine === "media3" ? isNativeMedia3SupportedStreamKind(kind) : isVlcSupportedStreamKind(kind);

    if (playbackFocused && uri && engine === "media3" && playerEngine === "auto" && !media3Available && vlcAvailable) {
      fallbackInFlightRef.current = playbackKey;
      setFallbackKey(playbackKey);
      return;
    }

    if (!playbackFocused || !uri || !engineAvailable) {
      generationRef.current = 0;
      if (role === "preview") void stopPreviewSession("superseded");
      // Fullscreen: background → pause only. Never stopFullscreenSession() from
      // AppState here — that destroyed the only decoder host on Onn inactive blips.
      else if (!appInForeground) void pauseActiveNativePlayback(role).catch(() => undefined);
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

    const isCurrent = () => !cancelled && isSessionCurrent(role, generation);
    void activateNativePlaybackEngine(role, engine, isCurrent, () => {
      const source = currentSourceRef.current;
      if (engine === "vlc") {
        if (role === "preview") {
          prepareNativeVlcPreview(generation, currentChannelKey, source.uri, source.headers, vlcHardwareDecode, vlcAudioOutput, bufferProfile);
        } else {
          prepareNativeVlcFullscreen(generation, currentChannelKey, source.uri, source.headers, vlcHardwareDecode, vlcAudioOutput, bufferProfile);
        }
        setNativeVlcMuted(role === "preview" && controlRef.current.muted);
        setNativeVlcResizeMode(role === "fullscreen" ? controlRef.current.scaleMode : "fit");
        if (controlRef.current.paused) pauseNativeVlcPlayback();
      } else {
        if (role === "preview") prepareNativePreview(generation, currentChannelKey, source.uri, source.headers, source.contentType, bufferProfile);
        else prepareNativeFullscreen(generation, currentChannelKey, source.uri, source.headers, source.contentType, bufferProfile);
        setNativePlaybackMuted(role === "preview" && controlRef.current.muted);
        setNativePlaybackResizeMode(role === "fullscreen" ? controlRef.current.scaleMode : "fit");
        if (controlRef.current.paused) pauseNativePlayback();
      }
    }).catch(() => {
      if (!isCurrent()) return;
      setSessionPhase(role, generation, "failed", "stream-error");
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("error", "stream-error");
    });

    return () => {
      cancelled = true;
      if (generationRef.current === generation) generationRef.current = 0;
    };
  }, [
    appInForeground,
    bufferProfile,
    contentType,
    currentChannelKey,
    headers,
    kind,
    playbackKey,
    playbackFocused,
    engine,
    playerEngine,
    role,
    uri,
    vlcAudioOutput,
    vlcHardwareDecode,
  ]);

  useEffect(() => {
    const generation = generationRef.current;
    if (!playbackFocused || !generation) return;
    void runNativePlaybackCommand(role, engine, () => isSessionCurrent(role, generation), () => {
      if (engine === "vlc") {
        setNativeVlcMuted(role === "preview" && muted);
        setNativeVlcResizeMode(role === "fullscreen" ? scaleMode : "fit");
        if (paused) pauseNativeVlcPlayback(); else resumeNativeVlcPlayback();
      } else {
        setNativePlaybackMuted(role === "preview" && muted);
        setNativePlaybackResizeMode(role === "fullscreen" ? scaleMode : "fit");
        if (paused) pauseNativePlayback(); else resumeNativePlayback();
      }
    }).catch(() => undefined);
  }, [muted, paused, scaleMode, engine, role, playbackFocused]);

  useEffect(() => {
    const generation = generationRef.current;
    if (!playbackFocused || !generation || audioTrack == null) return;
    const selected = tracksRef.current.audio.find((track) => String(track.id) === String(audioTrack)) ?? null;
    void runNativePlaybackCommand(role, engine, () => isSessionCurrent(role, generation), () => {
      if (engine === "vlc") selectNativeVlcAudio(selected); else selectNativeAudio(selected, null);
    }).catch(() => undefined);
  }, [audioTrack, engine, playbackFocused, role]);

  useEffect(() => {
    const generation = generationRef.current;
    if (!playbackFocused || !generation) return;
    const selected = textTrack == null ? null : tracksRef.current.text.find((track) => String(track.id) === String(textTrack)) ?? null;
    void runNativePlaybackCommand(role, engine, () => isSessionCurrent(role, generation), () => {
      if (engine === "vlc") selectNativeVlcSubtitle(selected);
      else if (textTrack == null) selectNativeSubtitle(null, null);
      else selectNativeSubtitle(selected, null);
    }).catch(() => undefined);
  }, [engine, textTrack, playbackFocused, role]);

  // Fullscreen must keep the native surface mounted whenever a URI exists.
  // Returning null here previously destroyed TextureView mid-tune on focus
  // flickers → black+silent with no error UI on both engines.
  if (!uri) return null;
  if (role === "preview" && !playbackFocused) return null;
  if (Platform.OS !== "android") return <View pointerEvents="none" collapsable={false} style={style} />;
  if (engine === "vlc") {
    return nativeVlcPlaybackAvailable()
      ? <NativeVlcPlaybackSurface owner={owner} pointerEvents="none" collapsable={false} renderToHardwareTextureAndroid={false} style={style} />
      : <View pointerEvents="none" collapsable={false} style={style} />;
  }
  return nativePlaybackAvailable()
    ? <NativePlaybackSurface owner={owner} pointerEvents="none" collapsable={false} renderToHardwareTextureAndroid={false} style={style} />
    : <View pointerEvents="none" collapsable={false} style={style} />;
}
