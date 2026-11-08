import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StreamPlayer, type StreamStatus, type StreamTrack, type PlayerScaleMode } from "@/src/components/StreamPlayer";
import { takeProviderMedia } from "@/src/core/providerMediaSession";
import { stopAllPlaybackSessions, stopFullscreenSession } from "@/src/core/playbackSession";
import { addTvKeyListener, resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";
import { tvColors } from "@/src/theme";
import { getNativeTimeline, seekNativeTimeline, type NativeTimeline } from "@/src/nativePlayback";
import { readProviderLibrary, updateProviderLibrary } from "@/src/core/providerLibrary";
import { providerResumePosition, type ProviderLibraryEntry } from "@/src/core/providerLibraryCore";
import { getPlaylistUrl, listPlaylists, usePlaylists } from "@/src/core/playlistRegistry";
import { decodeXtream, encodeXtream } from "@/src/core/xtream";
import { decodeStalker, encodeStalker } from "@/src/core/stalker";
import { usePlaybackBufferProfile } from "@/src/core/playbackBufferProfile";

/** Provider movies/episodes/replays use MediaLab's existing single decoder. */
export default function ProviderPlayer() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [media] = useState(() => takeProviderMedia(String(token || "")));
  const [ready, setReady] = useState(false), [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [controls, setControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const playlists = usePlaylists();
  const [bufferProfile] = usePlaybackBufferProfile();
  const [audioTracks, setAudioTracks] = useState<StreamTrack[]>([]), [textTracks, setTextTracks] = useState<StreamTrack[]>([]);
  const [audioTrack, setAudioTrack] = useState<string | number | undefined>(), [textTrack, setTextTrack] = useState<string | number | null | undefined>();
  const [trackPanel, setTrackPanel] = useState<"audio" | "text" | null>(null), [scale, setScale] = useState<PlayerScaleMode>("fit");
  const [timeline, setTimeline] = useState<NativeTimeline | null>(null);
  const lastTimeline = useRef<NativeTimeline | null>(null);
  const resume = useRef<ProviderLibraryEntry | null | undefined>(null), resumeApplied = useRef(false), exitInFlight = useRef(false);
  const lastSaved = useRef(0);
  const recentStartRecorded = useRef(false);
  // Record playback start even if the viewer stops before the first 5-second
  // progress checkpoint; do not overwrite a saved resume position.
  useEffect(() => {
    if (!media || !ready || status !== "playing" || recentStartRecorded.current ||
        !media.catalogKind || !media.catalogId) return;
    recentStartRecorded.current = true;
    void updateProviderLibrary({
      owner: media.owner,
      kind: media.catalogKind,
      catalogId: media.catalogId,
      title: media.title,
      mediaId: media.id,
      updatedAt: Date.now(),
    }).catch(() => { recentStartRecorded.current = false; });
  }, [media, ready, status]);
  const key = media ? `provider:${media.owner}:${media.id}` : "";
  const saveTimeline = useCallback((value: NativeTimeline) => {
    if (!media?.catalogKind || !media.catalogId || value.durationMs <= 0) return;
    const positionMs = value.ended || value.positionMs >= value.durationMs - 1000 ? 0 : value.positionMs;
    void updateProviderLibrary({ owner: media.owner, kind: media.catalogKind, catalogId: media.catalogId,
      title: media.title, mediaId: media.id, positionMs, durationMs: value.durationMs, updatedAt: Date.now() }).catch(() => undefined);
  }, [media]);
  const verifySource = useCallback(async () => {
    if (!media) throw new Error();
    const row = (await listPlaylists()).find(item => item.id === media.owner && item.enabled);
    if (!row) throw new Error();
    const secret = await getPlaylistUrl(row);
    const xtream = row.kind === "xtream" ? decodeXtream(secret) : null;
    const stalker = row.kind === "stalker" ? decodeStalker(secret) : null;
    const current = xtream ? encodeXtream(xtream) : stalker ? encodeStalker(stalker) : "";
    if (!current || current !== media.providerLogin) throw new Error();
  }, [media]);
  useEffect(() => {
    let alive = true;
    void readProviderLibrary().then(rows => {
      const saved = rows.find(row => row.owner === media?.owner && row.kind === media?.catalogKind && row.catalogId === media?.catalogId && row.mediaId === media?.id);
      if (alive) resume.current = saved;
    });
    return () => { alive = false; };
  }, [media]);
  useEffect(() => {
    if (!ready || !key) return;
    let alive = true, reading = false;
    const read = async () => {
      if (reading) return; reading = true;
      try {
        const value = await getNativeTimeline(key); if (!alive || !value) return;
        lastTimeline.current = value;
        setTimeline(value);
        if (!resumeApplied.current && resume.current !== null && value.durationMs > 0 && value.seekable) {
          resumeApplied.current = true;
          const position = providerResumePosition(resume.current, media?.id || "", value.durationMs);
          if (position > 0) { seekNativeTimeline(key, value.generation, position); return; }
        }
        if (resumeApplied.current && value.positionMs > 0 && Date.now() - lastSaved.current >= 5000) {
          lastSaved.current = Date.now();
          saveTimeline(value);
        }
      } catch { /* A released/newer native session has no timeline for this route. */ }
      finally { reading = false; }
    };
    void read(); const timer = setInterval(() => { void read(); }, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [key, media, ready, saveTimeline]);
  const seek = useCallback((delta: number) => {
    if (!timeline?.seekable) return;
    seekNativeTimeline(key, timeline.generation, Math.max(0, Math.min(timeline.durationMs, timeline.positionMs + delta)));
    setControls(true);
  }, [key, timeline]);
  useEffect(() => {
    if (!media) return;
    let alive = true;
    setRemoteContext("player");
    void stopAllPlaybackSessions("superseded").then(async () => { await verifySource(); if (alive) setReady(true); }).catch(() => { if (alive) setError("Could not start this provider title. Check that the source is enabled, or go back and try again."); });
    return () => { alive = false; resetRemoteContextIfOwned("player", "default"); };
  }, [media, verifySource]);
  useEffect(() => {
    if (!media || !ready) return;
    let alive = true;
    void verifySource().catch(() => { if (alive) { setReady(false); setError("This provider changed, was disabled, or was removed. Return to your library."); void stopFullscreenSession().catch(() => undefined); } });
    return () => { alive = false; };
  }, [media, playlists, ready, verifySource]);
  const exit = useCallback(() => {
    if (exitInFlight.current) return;
    if (!media) { router.back(); return; }
    exitInFlight.current = true;
    if (ready && lastTimeline.current && resumeApplied.current) saveTimeline(lastTimeline.current);
    void stopFullscreenSession().then(() => router.back()).catch(() => {
      exitInFlight.current = false;
      setError("Could not release playback. Press Back to try again.");
    });
  }, [media, ready, router, saveTimeline]);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => { exit(); return true; });
    const keys = addTvKeyListener(key => { if (key !== "BACK") setControls(true); });
    return () => { back.remove(); keys(); };
  }, [exit]);
  useEffect(() => {
    if (!controls || paused || trackPanel || status !== "playing") return;
    const timer = setTimeout(() => setControls(false), 5000);
    return () => clearTimeout(timer);
  }, [controls, paused, status, trackPanel]);
  return <View style={styles.root}>
    {ready && media ? <StreamPlayer uri={media.url} channelKey={`provider:${media.owner}:${media.id}`} streamTypeHint={media.format === "m3u8" ? "hls" : media.format === "ts" ? "ts" : media.format ? "progressive" : undefined}
      mode="full" sessionRole="fullscreen" paused={paused} audioTrack={audioTrack} textTrack={textTrack} scaleMode={scale} bufferProfile={bufferProfile}
      onTracksAvailable={tracks => { setAudioTracks(tracks.audio.filter(track => track.isSupported !== false)); setTextTracks(tracks.text.filter(track => track.isSupported !== false)); }}
      onStatus={setStatus} style={StyleSheet.absoluteFill} /> : null}
    <Pressable focusable={false} style={StyleSheet.absoluteFill} onPress={() => setControls(value => !value)} />
    {controls || !media || error || status === "error" || timeline?.ended ? <View style={styles.controls}>
      <Text style={styles.title}>{media?.title || "This playback request has expired. Return to your provider library."}</Text>
      {error ? <Text accessibilityRole="alert" style={styles.text}>{error}</Text> : null}
      {status === "error" ? <Text style={styles.text}>The provider could not play this title. Return and try another item.</Text> : null}
      <View style={styles.row}>
        {ready && timeline?.seekable ? <Pressable onPress={() => seek(-10_000)} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>−10 sec</Text></Pressable> : null}
        {ready && status !== "error" && (!timeline?.ended || timeline.seekable) ? <Pressable hasTVPreferredFocus onPress={() => {
          if (timeline?.ended) { seekNativeTimeline(key, timeline.generation, 0); setPaused(false); }
          else setPaused(value => !value);
        }} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>{timeline?.ended ? "Play again" : paused ? "Play" : "Pause"}</Text></Pressable> : null}
        {ready && timeline?.seekable ? <Pressable onPress={() => seek(10_000)} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>+10 sec</Text></Pressable> : null}
        {media && ready ? <><Pressable onPress={() => setTrackPanel(value => value === "audio" ? null : "audio")} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>Audio</Text></Pressable>
          <Pressable onPress={() => setTrackPanel(value => value === "text" ? null : "text")} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>Subtitles</Text></Pressable>
          <Pressable onPress={() => { const modes: PlayerScaleMode[] = ["fit", "fill", "zoom", "stretch"]; setScale(modes[(modes.indexOf(scale) + 1) % modes.length]); }} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>Aspect: {scale}</Text></Pressable></> : null}
        <Pressable onPress={exit} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>Back</Text></Pressable>
      </View>
      {ready && trackPanel ? <View style={[styles.row, { flexWrap: "wrap" }]}>
        {trackPanel === "text" ? <Pressable onPress={() => { setTextTrack(null); setTrackPanel(null); }} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>Subtitles off</Text></Pressable> : null}
        {(trackPanel === "audio" ? audioTracks : textTracks).map(track => <Pressable key={track.id} onPress={() => { if (trackPanel === "audio") setAudioTrack(track.id); else setTextTrack(track.id); setTrackPanel(null); }} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>{track.name || String(track.id)}</Text></Pressable>)}
        {!(trackPanel === "audio" ? audioTracks : textTracks).length ? <Text style={styles.text}>No additional tracks are available for this title.</Text> : null}
      </View> : null}
      {timeline && timeline.durationMs > 0 ? <Text style={styles.text}>{Math.floor(timeline.positionMs / 60_000)}:{String(Math.floor(timeline.positionMs / 1000) % 60).padStart(2, "0")} / {Math.floor(timeline.durationMs / 60_000)}:{String(Math.floor(timeline.durationMs / 1000) % 60).padStart(2, "0")}</Text> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#000" }, controls: { position: "absolute", left: 24, right: 24, bottom: 24, backgroundColor: "rgba(12,7,26,.88)", padding: 18, borderRadius: 10, gap: 12 }, title: { color: "#fff", fontSize: 22 }, text: { color: "#fff", fontSize: 16 }, row: { flexDirection: "row", gap: 12 }, button: { padding: 14, backgroundColor: tvColors.purpleDeep, borderRadius: 6, borderWidth: 2, borderColor: "transparent" }, focus: { borderColor: "#fff" } });
