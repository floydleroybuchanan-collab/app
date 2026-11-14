import { ProgressBar, TypedTask } from "@/src/components/StartupEffects";
import { StartupScene, useMotionAllowed, useStartupStage } from "@/src/components/StartupScene";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { subscribeProgress, type EpgProgress } from "@/src/source";
import { useStore } from "@/src/store";

const INITIAL: EpgProgress = { phase: "idle", ratio: 0, etaSeconds: null, message: null };
// The screen leaves as soon as the real work is done (cache opened, guide database
// checked, channels loaded) once it has been up long enough not to flash. If
// something is slow it still leaves at the deadline; loading carries on behind it.
const STARTUP_SEQUENCE_MS = 8_000;
const MIN_VISIBLE_MS = 1_200;
const FADE_IN_MS = 800;
const FADE_OUT_MS = 450;
let completedForSession = false;

/** Real-event startup gate: never sleeps and never waits for a complete XMLTV import. */
export function StartupVersion4() {
  const { allChannels: channels, loading, windowStart, windowEnd } = useStore();
  const [epg, setEpg] = useState(INITIAL);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [shown, setShown] = useState(0);
  const targetRef = useRef(0);
  const stage = useStartupStage();
  const run = useMotionAllowed();
  const fade = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState(completedForSession);
  useEffect(() => subscribeProgress(setEpg), []);
  useEffect(() => {
    if (done) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedMs(Math.min(STARTUP_SEQUENCE_MS, Date.now() - startedAt));
      // The bar glides toward the real progress, so it never jumps.
      setShown((current) => current + (targetRef.current - current) * 0.25);
    }, 100);
    return () => clearInterval(timer);
  }, [done]);
  const databaseReady = Number.isFinite(Date.parse(windowStart)) && Number.isFinite(Date.parse(windowEnd));
  const channelsReady = channels.length > 0;
  const epgStarted = epg.phase !== "idle" && epg.phase !== "channels";
  const freshCacheReady = channelsReady && databaseReady && !loading;
  const deadlineReached = elapsedMs >= STARTUP_SEQUENCE_MS;
  // Leave when the real work is done, or at the deadline. Initialization keeps
  // running in the store after the overlay leaves, including XMLTV import.
  const mayEnter = (freshCacheReady && elapsedMs >= MIN_VISIBLE_MS) || deadlineReached;
  const cacheReady = channelsReady || !loading;
  const guideReady = freshCacheReady || epg.phase === "ready";
  const milestones = useMemo(() => [
    { label: "Opening local cache", ready: cacheReady },
    { label: "Checking guide database", ready: databaseReady },
    { label: channelsReady ? `Loaded ${channels.length.toLocaleString()} channels from your playlists` : "Loading channels from your playlists", ready: channelsReady && !loading },
    { label: epgStarted ? `Guide ${epg.phase}` : guideReady ? "Guide is up to date" : "Starting guide in background", ready: guideReady },
  ], [cacheReady, channels.length, channelsReady, databaseReady, epg.phase, epgStarted, guideReady, loading]);
  targetRef.current = milestones.filter((item) => item.ready).length / milestones.length;
  // Fades in from black, and fades out once the real work is done.
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: FADE_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true, isInteraction: false }).start();
  }, [fade]);
  useEffect(() => {
    if (!mayEnter) return;
    Animated.timing(fade, { toValue: 0, duration: FADE_OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true, isInteraction: false }).start(({ finished }) => {
      if (finished) { completedForSession = true; setDone(true); }
    });
  }, [mayEnter, fade]);
  if (completedForSession) return null;
  // Sizes follow the approved 1920 x 1080 design, but never below a readable size or wider than the screen.
  const unit = Math.max(0.55, Math.min(stage.width / 1920, stage.height / 1080));
  const boxW = Math.min(800 * unit, stage.width - 32);
  const boxH = 214 * unit;
  const boxTop = Math.max(16, Math.min(stage.top + 792 * stage.cover, stage.height - boxH - 16));
  const pending = milestones.find((item) => !item.ready);
  const task = pending ? pending.label : "Ready";
  const guidePercent = guideReady ? 100 : Math.round(Math.min(1, Math.max(0, epg.ratio)) * 100);
  const percent = Math.round(Math.min(1, Math.max(shown, 0.04)) * 100);
  // The puddles spread as loading advances (smooth ease over the real progress).
  const growth = percent / 100 * percent / 100 * (3 - 2 * percent / 100);
  return (
    <Animated.View style={[styles.overlay, { opacity: fade }]} testID="startup-version-4">
      <StartupScene growth={growth} />
      <View style={[styles.box, { top: boxTop, left: (stage.width - boxW) / 2, width: boxW, minHeight: boxH, borderRadius: 28 * unit, paddingHorizontal: 40 * unit, paddingTop: 22 * unit, paddingBottom: 18 * unit }]}>
        <ProgressBar label="Loading Charming MediaLab" right={`${percent}%`} percent={percent} unit={unit} run={run} thick />
        <ProgressBar label="TV guide and library" right={`${guidePercent}%`} percent={guidePercent} unit={unit} run={run} />
        <View accessibilityLabel="Startup milestones" style={styles.dots}>
          {milestones.map((item) => <View key={item.label} style={[styles.dot, item.ready && styles.dotReady]} />)}
        </View>
        <TypedTask text={task} unit={unit} run={run} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, backgroundColor: "#000" },
  // 75% see-through glass, as in the approved design
  box: { position: "absolute", backgroundColor: "rgba(14,8,34,.25)", borderWidth: 1.5, borderColor: "rgba(226,190,255,.30)" },
  dots: { flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: "rgba(226,190,255,.45)", backgroundColor: "transparent" },
  dotReady: { borderColor: "#D793FF", backgroundColor: "#D793FF" },
});
