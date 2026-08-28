import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, requireNativeComponent, StyleProp, View, ViewProps, ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import {
  detectStreamKind,
  isNativeMedia3SupportedStreamKind,
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
import { getPlayerEnginePreference } from "@/src/playerEnginePreference";
import {
  invalidateConfirmedStreamType,
  getChannelPlaybackProfile,
  rememberConfirmedStreamType,
  rememberDeclaredStreamType,
  rememberPlaybackEngine,
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

// A single serialized coordinator owns preview/fullscreen transitions. It waits
// for the native ownership acknowledgement before another session may prepare.
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
  const engine = getPlayerEnginePreference();
  useSyncExternalStore(subscribePlaybackOwnership, getPlaybackOwnershipRevision, getPlaybackOwnershipRevision);
  const previewAllowed = role !== "preview" || isPreviewPlaybackAllowed();
  // Android TV fires AppState "inactive" for overlays / focus blips without
  // leaving the player. Treating inactive as dead tore down the native surface
  // and stopped fullscreen playback, leaving permanent black and silent video.
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
  // Snapshot learned metadata for this source identity. Subscribing to profile
  // confirmations here can change kind/contentType after a successful frame
  // and rerun the prepare effect on the channel that is already playing.
  const learnedHint = useMemo(() => {
    const confirmedType = getChannelPlaybackProfile(currentChannelKey)?.confirmedType;
    const uriKind = detectStreamKind(uri, null);
    if (uriKind === "unknown") {
      const hint = String(streamTypeHint || "").trim().toLowerCase();
      // Ignore progressive confirms on extensionless live URLs (no live-TS flags).
      if (!hint || hint === "unknown" || hint === "progressive" || confirmedType === "progressive") {
        return "unknown";
      }
      return hint;
    }
    return confirmedType ?? streamTypeHint;
  }, [currentChannelKey, streamTypeHint, uri]);
  const kind = useMemo(() => detectStreamKind(uri, learnedHint), [learnedHint, uri]);
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const playbackKey = useMemo(
    () => `${currentChannelKey}\u0000${rawUri}`,
    [currentChannelKey, rawUri],
  );
  const controlRef = useRef({ muted, paused, scaleMode });
  controlRef.current = { muted, paused, scaleMode };
  const currentSourceRef = useRef({ key: playbackKey, uri, headers, contentType });
  // A native authentication refresh must survive renders and native recovery.
  // Only an explicit source/tune change may replace the refreshed provider URL.
  if (currentSourceRef.current.key !== playbackKey) {
    currentSourceRef.current = { key: playbackKey, uri, headers, contentType };
  }

  useEffect(() => {
    tracksRef.current = { audio: [], text: [] };
  }, [engine, playbackKey]);

  useEffect(() => {
    rememberDeclaredStreamType(currentChannelKey, profileType(declaredKind));
  }, [currentChannelKey, declaredKind]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state !== "background"));
    return () => sub.remove();
  }, []);

  useEffect(() => addNativePlaybackStateListener((event) => {
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
      setSessionPhase(role, generation, "failed", reason);
      if (role === "fullscreen") setNativePlaybackStarting(false);
      // Drop a wrong Media3 confirm so the next tune re-enters opaque routing.
      invalidateConfirmedStreamType(currentChannelKey);
      onStatusRef.current("error", reason);
    }
  }), [currentChannelKey, owner, engine, role]);

  useEffect(() => addNativePlaybackDiagnosticListener((event) => {
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
        const freshKind = detectStreamKind(fresh.uri, channel.stream_type);
        if (!isNativeMedia3SupportedStreamKind(freshKind)) {
          resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "unsupported-protocol");
          return;
        }
        const freshType = media3ContentType(freshKind);
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

  useEffect(() => () => {
    if (role === "preview") void stopPreviewSession("superseded");
  }, [role]);

  useEffect(() => {
    const media3Available = Platform.OS === "android" && nativePlaybackAvailable();
    const engineAvailable = media3Available;
    const kindSupported = isNativeMedia3SupportedStreamKind(kind);

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
      // No compatibility engine is packaged. Reject unsupported transports
      // explicitly instead of repeatedly remounting a decoder that cannot play them.
      // Retire the prior channel too; otherwise its audio could continue under
      // the new channel's error screen after a same-role tune.
      void releaseNativePlaybackRole(role).catch(() => undefined);
      if (role === "fullscreen") setNativePlaybackStarting(false);
      onStatusRef.current("error", "unsupported-protocol");
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
      if (role === "preview") prepareNativePreview(generation, currentChannelKey, source.uri, source.headers, source.contentType, bufferProfile);
      else prepareNativeFullscreen(generation, currentChannelKey, source.uri, source.headers, source.contentType, bufferProfile);
      setNativePlaybackMuted(role === "preview" && controlRef.current.muted);
      setNativePlaybackResizeMode(role === "fullscreen" ? controlRef.current.scaleMode : "fit");
      if (controlRef.current.paused) pauseNativePlayback();
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
    role,
    uri,
  ]);

  useEffect(() => {
    const generation = generationRef.current;
    if (!playbackFocused || !generation) return;
    void runNativePlaybackCommand(role, engine, () => isSessionCurrent(role, generation), () => {
      setNativePlaybackMuted(role === "preview" && muted);
      setNativePlaybackResizeMode(role === "fullscreen" ? scaleMode : "fit");
      if (paused) pauseNativePlayback(); else resumeNativePlayback();
    }).catch(() => undefined);
  }, [muted, paused, scaleMode, engine, role, playbackFocused]);

  useEffect(() => {
    const generation = generationRef.current;
    if (!playbackFocused || !generation || audioTrack == null) return;
    const selected = tracksRef.current.audio.find((track) => String(track.id) === String(audioTrack)) ?? null;
    void runNativePlaybackCommand(role, engine, () => isSessionCurrent(role, generation), () => {
      selectNativeAudio(selected, null);
    }).catch(() => undefined);
  }, [audioTrack, engine, playbackFocused, role]);

  useEffect(() => {
    const generation = generationRef.current;
    if (!playbackFocused || !generation) return;
    const selected = textTrack == null ? null : tracksRef.current.text.find((track) => String(track.id) === String(textTrack)) ?? null;
    void runNativePlaybackCommand(role, engine, () => isSessionCurrent(role, generation), () => {
      if (textTrack == null) selectNativeSubtitle(null, null);
      else selectNativeSubtitle(selected, null);
    }).catch(() => undefined);
  }, [engine, textTrack, playbackFocused, role]);

  // Fullscreen must keep the native surface mounted whenever a URI exists.
  // Returning null here previously destroyed TextureView mid-tune on focus
  // flickers, leaving black and silent video with no error UI.
  if (!uri) return null;
  if (role === "preview" && !playbackFocused) return null;
  if (Platform.OS !== "android") return <View pointerEvents="none" collapsable={false} style={style} />;
  return nativePlaybackAvailable()
    ? <NativePlaybackSurface owner={owner} pointerEvents="none" collapsable={false} renderToHardwareTextureAndroid={false} style={style} />
    : <View pointerEvents="none" collapsable={false} style={style} />;
}
