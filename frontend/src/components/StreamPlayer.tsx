import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, requireNativeComponent, StyleProp, View, ViewProps, ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { detectStreamKind, media3ContentType, parsePipeHeaders } from "@/src/core/streamPolicy";
import {
  beginSession,
  getPlaybackOwnershipRevision,
  isPreviewPlaybackAllowed,
  isSessionCurrent,
  setNativePlaybackPauseHandler,
  setNativePlaybackReleaseHandler,
  setSessionPhase,
  stopFullscreenSession,
  subscribePlaybackOwnership,
  type SessionFailReason,
  type SessionRole,
} from "@/src/core/playbackSession";
import {
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
import { getPreferredAudioLanguage, getRememberedChannelAudioTrack } from "@/src/core/audioTrackPreferences";
import type { PlaybackBufferProfile } from "@/src/core/playbackBufferProfile";
import { setNativePlaybackStarting } from "@/src/utils/tvRemote";
import { refreshPlaybackChannel } from "@/src/source";

export type StreamStatus = "loading" | "playing" | "error";
export type PlayerScaleMode = "fit" | "zoom" | "stretch";
export type StreamTrack = { id: string | number; name: string; mimeType?: string | null; isSupported?: boolean };

type NativePlaybackSurfaceProps = ViewProps & { owner: "preview" | "fullscreen" };
const NativePlaybackSurface = requireNativeComponent<NativePlaybackSurfaceProps>("CharmNativePlaybackSurface");

setNativePlaybackReleaseHandler((role) => role === "preview" ? stopNativePreview() : stopNativeFullscreen(true));
setNativePlaybackPauseHandler((role) => { if (role === "fullscreen") pauseNativePlayback(); });

type Props = {
  uri: string;
  channelKey?: string;
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

export function StreamPlayer({
  uri: rawUri,
  channelKey,
  onStatus,
  style,
  mode = "full",
  sessionRole,
  muted = false,
  audioTrack,
  textTrack,
  onTracksAvailable,
  paused = false,
  scaleMode = "fit",
}: Props) {
  const role: SessionRole = sessionRole ?? (mode === "preview" ? "preview" : "fullscreen");
  const owner = role === "preview" ? "preview" : "fullscreen";
  const isFocused = useIsFocused();
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
  const kind = useMemo(() => detectStreamKind(uri), [uri]);
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const currentSourceRef = useRef({ uri, headers, contentType });
  currentSourceRef.current = { uri, headers, contentType };

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state !== "background" && state !== "inactive"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return addNativePlaybackStateListener((event) => {
      if (event.owner !== owner) return;
      const generation = generationRef.current;
      if (!generation || !isSessionCurrent(role, generation)) return;
      if (event.state === "playing") {
        setSessionPhase(role, generation, "playing");
        if (role === "fullscreen") setNativePlaybackStarting(false);
        onStatusRef.current("playing", null);
      } else if (event.state === "loading") {
        setSessionPhase(role, generation, event.reason === "native-reprepare" ? "recovering" : "preparing", event.reason === "native-reprepare" ? "stream-error" : null);
        onStatusRef.current("loading", event.reason === "native-reprepare" ? "stream-error" : null);
      } else {
        const reason: SessionFailReason = event.reason === "start-timeout" ? "start-timeout" : "stream-error";
        setSessionPhase(role, generation, "failed", reason);
        if (role === "fullscreen") setNativePlaybackStarting(false);
        onStatusRef.current("error", reason);
      }
    });
  }, [owner, role]);

  useEffect(() => {
    return addNativePlaybackSourceRefreshListener((event) => {
      if (event.owner !== owner || !channelKey || event.channelKey !== channelKey) return;
      const generation = generationRef.current;
      if (!generation || !isSessionCurrent(role, generation)) {
        resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session");
        return;
      }
      // Only a real 401/403 means the provider issued a token/session that
      // expired - that's the only case where re-downloading the whole
      // playlist to find a new URL can actually help. For an ordinary
      // stall/freeze/live-edge hiccup on a static m3u URL, the channel's URL
      // hasn't changed, so re-fetching thousands of playlist rows just burns
      // the native source-refresh timeout for nothing. Answer those cases
      // immediately with the URL already in use.
      if (!event.authenticationFailure) {
        const current = currentSourceRef.current;
        resolveNativePlaybackFreshSource(event.requestId, current.uri, current.headers, current.contentType, null);
        return;
      }
      void refreshPlaybackChannel(event.channelKey)
        .then((channel) => {
          if (!isSessionCurrent(role, generation) || !channel?.url) {
            resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "fresh-channel-unavailable");
            return;
          }
          const fresh = parsePipeHeaders(channel.url);
          const freshType = media3ContentType(detectStreamKind(fresh.uri));
          resolveNativePlaybackFreshSource(event.requestId, fresh.uri, fresh.headers, freshType, null);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.name : "source-refresh-failed";
          resolveNativePlaybackFreshSource(event.requestId, null, {}, null, message);
        });
    });
  }, [channelKey, owner, role]);

  useEffect(() => {
    return addNativePlaybackTracksListener((event) => {
      if (event.owner !== owner) return;
      tracksRef.current = { audio: event.audio, text: event.text };
      onTracksRef.current?.({
        audio: event.audio.map((track) => ({ id: track.id, name: track.name, mimeType: track.mimeType, isSupported: track.isSupported })),
        text: event.text.map((track) => ({ id: track.id, name: track.name })),
      });
      const remembered = audioTrack ?? getRememberedChannelAudioTrack(channelKey);
      const selectedAudio = remembered == null ? null : event.audio.find((track) => String(track.id) === String(remembered)) ?? null;
      selectNativeAudio(selectedAudio, selectedAudio ? null : getPreferredAudioLanguage());
      if (textTrack == null) selectNativeSubtitle(null, null);
      else selectNativeSubtitle(event.text.find((track) => String(track.id) === String(textTrack)) ?? null, null);
    });
  }, [audioTrack, channelKey, owner, textTrack]);

  useEffect(() => {
    if (!playbackFocused || !uri || Platform.OS !== "android" || !nativePlaybackAvailable()) {
      generationRef.current = 0;
      if (role === "preview") {
        void stopNativePreview();
      } else if (!appActive) {
        // Background teardown still releases the decoder, but navigation blur
        // is owned by stopFullscreenSession at the route/session layer. Do not
        // race a second direct native release against Guide remount.
        void stopFullscreenSession();
      }
      return;
    }
    const generation = beginSession(role);
    generationRef.current = generation;
    if (!generation) return;
    setSessionPhase(role, generation, "preparing");
    if (role === "fullscreen") setNativePlaybackStarting(true);
    onStatusRef.current("loading", null);
    if (role === "preview") prepareNativePreview(channelKey ?? "", uri, headers, contentType);
    else prepareNativeFullscreen(channelKey ?? "", uri, headers, contentType);
    return () => { if (generationRef.current === generation) generationRef.current = 0; };
  }, [appActive, channelKey, contentType, headers, isFocused, playbackFocused, role, uri]);

  useEffect(() => { setNativePlaybackMuted(muted); }, [muted]);
  useEffect(() => { if (paused) pauseNativePlayback(); else if (playbackFocused) resumeNativePlayback(); }, [paused, playbackFocused]);
  useEffect(() => { if (role === "fullscreen") setNativePlaybackResizeMode(scaleMode); }, [role, scaleMode]);

  useEffect(() => {
    const audio = tracksRef.current.audio;
    const selected = audioTrack == null ? null : audio.find((track) => String(track.id) === String(audioTrack)) ?? null;
    if (audioTrack != null) selectNativeAudio(selected, null);
  }, [audioTrack]);
  useEffect(() => {
    const text = tracksRef.current.text;
    if (textTrack == null) selectNativeSubtitle(null, null);
    else selectNativeSubtitle(text.find((track) => String(track.id) === String(textTrack)) ?? null, null);
  }, [textTrack]);

  if (!playbackFocused || !uri) return null;
  if (Platform.OS !== "android" || !nativePlaybackAvailable()) return <View pointerEvents="none" collapsable={false} style={style} />;
  return <NativePlaybackSurface owner={owner} pointerEvents="none" collapsable={false} style={style} />;
}
