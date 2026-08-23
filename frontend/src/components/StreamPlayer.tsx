import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, requireNativeComponent, StyleProp, View, ViewProps, ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { detectStreamKind, media3ContentType, parsePipeHeaders } from "@/src/core/streamPolicy";
import { beginSession, getPlaybackOwnershipRevision, isPreviewPlaybackAllowed, isSessionCurrent, setNativePlaybackPauseHandler, setNativePlaybackReleaseHandler, setSessionPhase, stopFullscreenSession, stopPreviewSession, subscribePlaybackOwnership, type SessionFailReason, type SessionRole } from "@/src/core/playbackSession";
import { addNativePlaybackStateListener, addNativePlaybackSourceRefreshListener, addNativePlaybackTracksListener, nativePlaybackAvailable, pauseNativePlayback, prepareNativeFullscreen, prepareNativePreview, resolveNativePlaybackFreshSource, resumeNativePlayback, selectNativeAudio, selectNativeSubtitle, setNativePlaybackMuted, setNativePlaybackResizeMode, stopNativeFullscreen, stopNativePreview, type NativePlaybackTrack } from "@/src/nativePlayback";
import { addNativeVlcStateListener, addNativeVlcTracksListener, nativeVlcPlaybackAvailable, pauseNativeVlcPlayback, prepareNativeVlcFullscreen, prepareNativeVlcPreview, resumeNativeVlcPlayback, selectNativeVlcAudio, selectNativeVlcSubtitle, setNativeVlcMuted, setNativeVlcResizeMode, stopNativeVlcFullscreen, stopNativeVlcPreview } from "@/src/nativeVlcPlayback";
import { usePlayerEnginePreference } from "@/src/playerEnginePreference";
import { useVlcPlaybackPreferences } from "@/src/core/vlcPlaybackPreferences";
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

setNativePlaybackReleaseHandler(async (role) => {
  if (role === "preview") { await Promise.allSettled([stopNativePreview(), stopNativeVlcPreview(true)]); }
  else { await Promise.allSettled([stopNativeFullscreen(true), stopNativeVlcFullscreen(true)]); }
});
setNativePlaybackPauseHandler(() => { pauseNativePlayback(); pauseNativeVlcPlayback(); });

type Props = {
  uri: string; channelKey?: string; streamTypeHint?: string | null;
  onStatus: (s: StreamStatus, reason?: SessionFailReason | null) => void;
  style?: StyleProp<ViewStyle>; mode?: "preview" | "full"; sessionRole?: SessionRole; muted?: boolean;
  audioTrack?: string | number; textTrack?: string | number | null;
  onTracksAvailable?: (tracks: { audio: StreamTrack[]; text: StreamTrack[] }) => void;
  bufferProfile?: PlaybackBufferProfile; paused?: boolean; scaleMode?: PlayerScaleMode;
};

export function StreamPlayer({ uri: rawUri, channelKey, streamTypeHint, onStatus, style, mode = "full", sessionRole, muted = false, audioTrack, textTrack, onTracksAvailable, bufferProfile = "stable", paused = false, scaleMode = "fit" }: Props) {
  const role: SessionRole = sessionRole ?? (mode === "preview" ? "preview" : "fullscreen");
  const owner = role === "preview" ? "preview" : "fullscreen";
  const isFocused = useIsFocused();
  const [engine] = usePlayerEnginePreference();
  const vlcPrefs = useVlcPlaybackPreferences();
  useSyncExternalStore(subscribePlaybackOwnership, getPlaybackOwnershipRevision, getPlaybackOwnershipRevision);
  const previewAllowed = role !== "preview" || isPreviewPlaybackAllowed();
  const [appActive, setAppActive] = useState(() => AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const playbackFocused = isFocused && appActive && previewAllowed;
  const generationRef = useRef(0);
  const tracksRef = useRef<{ audio: NativePlaybackTrack[]; text: NativePlaybackTrack[] }>({ audio: [], text: [] });
  const onStatusRef = useRef(onStatus); const onTracksRef = useRef(onTracksAvailable); onStatusRef.current = onStatus; onTracksRef.current = onTracksAvailable;
  const { uri, headers } = useMemo(() => parsePipeHeaders(rawUri), [rawUri]);
  const kind = useMemo(() => detectStreamKind(uri, streamTypeHint), [streamTypeHint, uri]);
  const contentType = useMemo(() => media3ContentType(kind), [kind]);
  const currentSourceRef = useRef({ uri, headers, contentType, streamTypeHint }); currentSourceRef.current = { uri, headers, contentType, streamTypeHint };

  useEffect(() => { const sub = AppState.addEventListener("change", (state) => setAppActive(state !== "background" && state !== "inactive")); return () => sub.remove(); }, []);

  useEffect(() => {
    const removeMedia3 = addNativePlaybackStateListener((event) => {
      if (engine !== "media3" || event.owner !== owner) return;
      const generation = generationRef.current; if (!generation || !isSessionCurrent(role, generation)) return;
      if (event.state === "playing") { setSessionPhase(role, generation, "playing"); if (role === "fullscreen") setNativePlaybackStarting(false); onStatusRef.current("playing", null); }
      else if (event.state === "loading") { setSessionPhase(role, generation, event.reason === "native-reprepare" ? "recovering" : "preparing", null); onStatusRef.current("loading", null); }
      else { const reason: SessionFailReason = event.reason === "start-timeout" ? "start-timeout" : "stream-error"; setSessionPhase(role, generation, "failed", reason); if (role === "fullscreen") setNativePlaybackStarting(false); onStatusRef.current("error", reason); }
    });
    const removeVlc = addNativeVlcStateListener((event) => {
      if (engine !== "vlc" || event.owner !== owner) return;
      const generation = generationRef.current; if (!generation || event.generation !== generation || !isSessionCurrent(role, generation)) return;
      if (event.state === "playing") { setSessionPhase(role, generation, "playing"); if (role === "fullscreen") setNativePlaybackStarting(false); onStatusRef.current("playing", null); }
      else if (event.state === "loading") { setSessionPhase(role, generation, "preparing", null); onStatusRef.current("loading", null); }
      else { setSessionPhase(role, generation, "failed", "stream-error"); if (role === "fullscreen") setNativePlaybackStarting(false); onStatusRef.current("error", "stream-error"); }
    });
    return () => { removeMedia3(); removeVlc(); };
  }, [engine, owner, role]);

  useEffect(() => {
    if (engine !== "media3") return;
    return addNativePlaybackSourceRefreshListener((event) => {
      if (event.owner !== owner || !channelKey || event.channelKey !== channelKey) return;
      const generation = generationRef.current;
      if (!generation || !isSessionCurrent(role, generation)) { resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session"); return; }
      const current = currentSourceRef.current;
      void refreshPlaybackChannel(event.channelKey).then((channel) => {
        if (!isSessionCurrent(role, generation)) { resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session"); return; }
        if (!channel?.url) { resolveNativePlaybackFreshSource(event.requestId, current.uri, current.headers, current.contentType, "fresh-channel-unavailable-reused-current"); return; }
        const fresh = parsePipeHeaders(channel.url); const freshType = media3ContentType(detectStreamKind(fresh.uri, channel.stream_type)); resolveNativePlaybackFreshSource(event.requestId, fresh.uri, fresh.headers, freshType, null);
      }).catch((error: unknown) => { if (!isSessionCurrent(role, generation)) { resolveNativePlaybackFreshSource(event.requestId, null, {}, null, "stale-playback-session"); return; } const message = error instanceof Error ? error.name : "source-refresh-failed"; resolveNativePlaybackFreshSource(event.requestId, current.uri, current.headers, current.contentType, `${message}-reused-current`); });
    });
  }, [channelKey, engine, owner, role]);

  useEffect(() => {
    const publish = (audio: NativePlaybackTrack[], text: NativePlaybackTrack[]) => {
      tracksRef.current = { audio, text }; onTracksRef.current?.({ audio: audio.map((t) => ({ id: t.id, name: t.name, mimeType: t.mimeType, isSupported: t.isSupported })), text: text.map((t) => ({ id: t.id, name: t.name })) });
      const remembered = audioTrack ?? getRememberedChannelAudioTrack(channelKey); const selectedAudio = remembered == null ? null : audio.find((t) => String(t.id) === String(remembered)) ?? null;
      if (engine === "vlc") { selectNativeVlcAudio(selectedAudio); selectNativeVlcSubtitle(textTrack == null ? null : text.find((t) => String(t.id) === String(textTrack)) ?? null); }
      else { selectNativeAudio(selectedAudio, selectedAudio ? null : getPreferredAudioLanguage()); if (textTrack == null) selectNativeSubtitle(null, null); else selectNativeSubtitle(text.find((t) => String(t.id) === String(textTrack)) ?? null, null); }
    };
    const removeMedia3 = addNativePlaybackTracksListener((event) => { if (engine === "media3" && event.owner === owner) publish(event.audio, event.text); });
    const removeVlc = addNativeVlcTracksListener((event) => { if (engine === "vlc" && event.owner === owner && event.generation === generationRef.current) publish(event.audio, event.text); });
    return () => { removeMedia3(); removeVlc(); };
  }, [audioTrack, channelKey, engine, owner, textTrack]);

  useEffect(() => () => { if (role === "preview") void stopPreviewSession("superseded"); }, [role]);

  useEffect(() => {
    if (!playbackFocused || !uri || Platform.OS !== "android" || (engine === "media3" ? !nativePlaybackAvailable() : !nativeVlcPlaybackAvailable())) {
      generationRef.current = 0; if (role === "preview") void stopPreviewSession("superseded"); else if (!appActive) void stopFullscreenSession(); return;
    }
    const generation = beginSession(role); generationRef.current = generation; if (!generation) return;
    setSessionPhase(role, generation, "preparing"); if (role === "fullscreen") setNativePlaybackStarting(true); onStatusRef.current("loading", null);
    const start = async () => {
      if (engine === "vlc") {
        if (role === "preview") await stopNativePreview(); else await stopNativeFullscreen(true);
        if (!isSessionCurrent(role, generation)) return;
        if (role === "preview") prepareNativeVlcPreview(generation, channelKey ?? "", uri, headers, vlcPrefs.hardwareDecode, vlcPrefs.audioOutput, bufferProfile);
        else prepareNativeVlcFullscreen(generation, channelKey ?? "", uri, headers, vlcPrefs.hardwareDecode, vlcPrefs.audioOutput, bufferProfile);
      } else {
        if (role === "preview") await stopNativeVlcPreview(true); else await stopNativeVlcFullscreen(true);
        if (!isSessionCurrent(role, generation)) return;
        if (role === "preview") prepareNativePreview(channelKey ?? "", uri, headers, contentType); else prepareNativeFullscreen(channelKey ?? "", uri, headers, contentType);
      }
    };
    void start();
    return () => { if (generationRef.current === generation) generationRef.current = 0; };
  }, [appActive, bufferProfile, channelKey, contentType, engine, headers, isFocused, playbackFocused, role, uri, vlcPrefs.audioOutput, vlcPrefs.hardwareDecode]);

  useEffect(() => { if (engine === "vlc") setNativeVlcMuted(muted); else setNativePlaybackMuted(muted); }, [engine, muted]);
  useEffect(() => { if (engine === "vlc") { if (paused) pauseNativeVlcPlayback(); else if (playbackFocused) resumeNativeVlcPlayback(); } else { if (paused) pauseNativePlayback(); else if (playbackFocused) resumeNativePlayback(); } }, [engine, paused, playbackFocused]);
  useEffect(() => { if (role !== "fullscreen") return; if (engine === "vlc") setNativeVlcResizeMode(scaleMode); else setNativePlaybackResizeMode(scaleMode); }, [engine, role, scaleMode]);
  useEffect(() => { const audio = tracksRef.current.audio; const selected = audioTrack == null ? null : audio.find((t) => String(t.id) === String(audioTrack)) ?? null; if (audioTrack != null) { if (engine === "vlc") selectNativeVlcAudio(selected); else selectNativeAudio(selected, null); } }, [audioTrack, engine]);
  useEffect(() => { const text = tracksRef.current.text; const selected = textTrack == null ? null : text.find((t) => String(t.id) === String(textTrack)) ?? null; if (engine === "vlc") selectNativeVlcSubtitle(selected); else if (textTrack == null) selectNativeSubtitle(null, null); else selectNativeSubtitle(selected, null); }, [engine, textTrack]);

  if (!playbackFocused || !uri) return null;
  if (Platform.OS !== "android") return <View pointerEvents="none" collapsable={false} style={style} />;
  if (engine === "vlc") return nativeVlcPlaybackAvailable() ? <NativeVlcPlaybackSurface owner={owner} pointerEvents="none" collapsable={false} style={style} /> : <View pointerEvents="none" collapsable={false} style={style} />;
  return nativePlaybackAvailable() ? <NativePlaybackSurface owner={owner} pointerEvents="none" collapsable={false} style={style} /> : <View pointerEvents="none" collapsable={false} style={style} />;
}
