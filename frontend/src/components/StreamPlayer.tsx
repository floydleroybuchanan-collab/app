import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

// Both engines share the same ownership gate. A channel is never decoded by
// Media3 and VLC at the same time: the opposite engine is stopped before prepare.
setNativePlaybackReleaseHandler(async (role) => {
  if (role === "preview") {
    await Promise.allSettled([stopNativePreview(), stopNativeVlcPreview(true)]);
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
  const [appActive, setAppActive] = useState(() => AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const playbackFocused = isFocused && appActive && previewAllowed;
  const generationRef = useRef(0);
  const tracksRef = useRef<{ audio: NativePlaybackTrack[]; text: NativePlaybackTrack[] }>({ audio: [], text: [] });
  const onStatusRef = useRef(onStatus);
  const onTracksRef = useRef(onTracksAvailable);
  onStatusRef.current = onStatus;
  onTracksRef.current = onTracksAvailable;

  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const declaredKind = useMemo(() => detectStreamKind(uri, streamTypeHint), [streamTypeHint, uri]);
  // A wrong Media3 "progressive" confirm on extensionless live IPTV URLs forces
  // DefaultMediaSourceFactory without live-TS flags → black+silent. Prefer the
  // playlist hint / URI markers until a non-progressive type is confirmed.
  const learnedHint = useMemo(() => {
    const confirmed = profile?.confirmedType;
    if (confirmed === "progressive" && detectStreamKind(uri, null) === "unknown") {
      return streamTypeHint;
    }
    return confirmed ?? streamTypeHint;
  }, [profile?.confirmedType, streamTypeHint, uri]);
  const kind = useMemo(() => detectStreamKind(uri, learnedHint), [learnedHint, uri]);
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const currentSourceRef = useRef({ uri, headers, contentType });
  currentSourceRef.current = { uri, headers, contentType };

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
      const reason: SessionFailReason =
        event.reason === "start-timeout"
          ? "start-timeout"
          : event.reason === "silent-audio"
            ? "silent-audio"
            : "stream-error";
      setSessionPhase(role, generation, "failed", reason);
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("error", reason);
    }
  }), [currentChannelKey, owner, playerEngine, role]);

  useEffect(() => addNativeVlcStateListener((event) => {
    if (playerEngine !== "vlc") return;
    const generation = generationRef.current;
    if (
      !generation ||
      event.owner !== owner ||
      event.generation !== generation ||
      event.channelKey !== currentChannelKey ||
      !isSessionCurrent(role, generation)
    ) return;
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
    if (event.event === "opaque-type-stable" && event.sourceType) {
      rememberConfirmedStreamType(currentChannelKey, event.sourceType, "media3");
    }
  }), [currentChannelKey, owner, playerEngine]);

  useEffect(() => addNativePlaybackSourceRefreshListener((event) => {
    if (playerEngine !== "media3") return;
    const generation = generationRef.current;
    if (
      event.owner !== owner ||
      event.generation !== generation ||
      event.channelKey !== currentChannelKey ||
      !generation ||
      !isSessionCurrent(role, generation)
    ) {
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
    const kindSupported = playerEngine === "media3" ? isNativeMedia3SupportedStreamKind(kind) : isVlcSupportedStreamKind(kind);

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
          prepareNativeVlcPreview(generation, currentChannelKey, uri, headers, vlcPrefs.hardwareDecode, vlcPrefs.audioOutput, bufferProfile);
        } else {
          prepareNativeVlcFullscreen(generation, currentChannelKey, uri, headers, vlcPrefs.hardwareDecode, vlcPrefs.audioOutput, bufferProfile);
        }
      } else {
        if (role === "preview") await stopNativeVlcPreview(true); else await stopNativeVlcFullscreen(true);
        if (cancelled || !isSessionCurrent(role, generation)) return;
        if (role === "preview") prepareNativePreview(generation, currentChannelKey, uri, headers, contentType, bufferProfile);
        else prepareNativeFullscreen(generation, currentChannelKey, uri, headers, contentType, bufferProfile);
      }
    })();

    return () => {
      cancelled = true;
      if (generationRef.current === generation) generationRef.current = 0;
    };
  }, [
    appActive,
    bufferProfile,
    contentType,
    currentChannelKey,
    headers,
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
    if (playerEngine === "vlc") selectNativeVlcSubtitle(selected);
    else if (textTrack == null) selectNativeSubtitle(null, null);
    else selectNativeSubtitle(selected, null);
  }, [playerEngine, textTrack]);

  if (!playbackFocused || !uri) return null;
  if (Platform.OS !== "android") return <View pointerEvents="none" collapsable={false} style={style} />;
  if (playerEngine === "vlc") {
    return nativeVlcPlaybackAvailable()
      ? <NativeVlcPlaybackSurface owner={owner} pointerEvents="none" collapsable={false} renderToHardwareTextureAndroid={false} style={style} />
      : <View pointerEvents="none" collapsable={false} style={style} />;
  }
  return nativePlaybackAvailable()
    ? <NativePlaybackSurface owner={owner} pointerEvents="none" collapsable={false} renderToHardwareTextureAndroid={false} style={style} />
    : <View pointerEvents="none" collapsable={false} style={style} />;
}
