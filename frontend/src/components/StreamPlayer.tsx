import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, requireNativeComponent, StyleProp, View, ViewProps, ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import {
  detectStreamKind,
  isNativeMedia3SupportedStreamKind,
  isVlcSupportedStreamKind,
  media3ContentType,
  parsePipeHeaders,
  preferredEngine,
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
  // Settings is an explicit force. "preferredEngine(kind)" is only the auto
  // path when we add a third preference later — today Media3/VLC both force.
  const activeEngine = useMemo(() => {
    if (playerEngine === "vlc") return "vlc";
    if (playerEngine === "media3") return "media3";
    return preferredEngine(kind);
  }, [kind, playerEngine]);
  const engine = activeEngine;
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const currentSourceRef = useRef({ uri, headers, contentType });
  currentSourceRef.current = { uri, headers, contentType };

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
      const reason: SessionFailReason =
        event.reason === "start-timeout"
          ? "start-timeout"
          : event.reason === "silent-audio"
            ? "silent-audio"
            : "stream-error";
      setSessionPhase(role, generation, "failed", reason);
      if (role === "fullscreen") setNativePlaybackStarting(false);
      // Drop a wrong Media3 confirm so the next tune re-enters opaque routing.
      invalidateConfirmedStreamType(currentChannelKey);
      onStatusRef.current("error", reason);
    }
  }), [currentChannelKey, owner, engine, role]);

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
  }), [currentChannelKey, owner, engine, role]);

  useEffect(() => addNativePlaybackDiagnosticListener((event) => {
    if (engine !== "media3") return;
    const generation = generationRef.current;
    if (!generation || event.owner !== owner || event.generation !== generation || event.channelKey !== currentChannelKey) return;
    if (event.event === "opaque-cache-invalidated") invalidateConfirmedStreamType(currentChannelKey);
    if (event.event === "opaque-type-stable" && event.sourceType) {
      rememberConfirmedStreamType(currentChannelKey, event.sourceType, "media3");
    }
  }), [currentChannelKey, owner, engine]);

  useEffect(() => addNativePlaybackSourceRefreshListener((event) => {
    if (engine !== "media3") return;
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
  }), [currentChannelKey, owner, engine, role]);

  useEffect(() => addNativePlaybackTracksListener((event) => {
    if (engine !== "media3") return;
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
  }), [audioTrack, currentChannelKey, owner, engine, textTrack]);

  useEffect(() => addNativeVlcTracksListener((event) => {
    if (engine !== "vlc") return;
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
  }), [audioTrack, currentChannelKey, owner, engine, textTrack]);

  useEffect(() => () => {
    if (role === "preview") void stopPreviewSession("superseded");
  }, [role]);

  useEffect(() => {
    const media3Available = Platform.OS === "android" && nativePlaybackAvailable();
    const vlcAvailable = Platform.OS === "android" && nativeVlcPlaybackAvailable();
    const engineAvailable = engine === "vlc" ? vlcAvailable : media3Available;
    const kindSupported = engine === "media3" ? isNativeMedia3SupportedStreamKind(kind) : isVlcSupportedStreamKind(kind);

    if (!playbackFocused || !uri || !engineAvailable) {
      generationRef.current = 0;
      if (role === "preview") void stopPreviewSession("superseded");
      // Fullscreen: background → pause only. Never stopFullscreenSession() from
      // AppState here — that destroyed the only decoder host on Onn inactive blips.
      else if (!appInForeground) {
        pauseNativePlayback();
        pauseNativeVlcPlayback();
      }
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
      if (engine === "vlc") {
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
    appInForeground,
    bufferProfile,
    contentType,
    currentChannelKey,
    headers,
    kind,
    playbackFocused,
    engine,
    role,
    uri,
    vlcPrefs.audioOutput,
    vlcPrefs.hardwareDecode,
  ]);

  useEffect(() => {
    // Preview mute is process-global on the native managers. Never let a
    // background Guide preview remute an active fullscreen session.
    if (role === "fullscreen") {
      if (engine === "vlc") setNativeVlcMuted(false);
      else setNativePlaybackMuted(false);
      return;
    }
    if (!playbackFocused) return;
    if (engine === "vlc") setNativeVlcMuted(muted);
    else setNativePlaybackMuted(muted);
  }, [muted, engine, role, playbackFocused]);

  useEffect(() => {
    if (engine === "vlc") {
      if (paused) pauseNativeVlcPlayback(); else if (playbackFocused) resumeNativeVlcPlayback();
    } else {
      if (paused) pauseNativePlayback(); else if (playbackFocused) resumeNativePlayback();
    }
  }, [paused, playbackFocused, engine]);

  useEffect(() => {
    if (role !== "fullscreen") return;
    if (engine === "vlc") setNativeVlcResizeMode(scaleMode); else setNativePlaybackResizeMode(scaleMode);
  }, [engine, role, scaleMode]);

  useEffect(() => {
    if (audioTrack == null) return;
    const selected = tracksRef.current.audio.find((track) => String(track.id) === String(audioTrack)) ?? null;
    if (engine === "vlc") selectNativeVlcAudio(selected); else selectNativeAudio(selected, null);
  }, [audioTrack, engine]);

  useEffect(() => {
    const selected = textTrack == null ? null : tracksRef.current.text.find((track) => String(track.id) === String(textTrack)) ?? null;
    if (engine === "vlc") selectNativeVlcSubtitle(selected);
    else if (textTrack == null) selectNativeSubtitle(null, null);
    else selectNativeSubtitle(selected, null);
  }, [engine, textTrack]);

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
