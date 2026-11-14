import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, type ImageSourcePropType, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fonts } from "@/src/theme";

/** The parts of the loading screen that follow the real loading progress, drawn live over the looping artwork. */

type Rgb = readonly [number, number, number];
const rgb = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lighten = (c: Rgb, by: number): Rgb => [Math.min(255, c[0] + by), Math.min(255, c[1] + by), Math.min(255, c[2] + by)];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const RAINBOW = ["#ff2bd6", "#ff3b30", "#ff9f0a", "#ffe600", "#20e070", "#14b8ff", "#3a5bff", "#a02bff"] as const;
const STOPS: Rgb[] = [[255, 36, 214], [255, 60, 40], [255, 170, 12], [255, 236, 20], [32, 224, 112], [20, 170, 255], [70, 90, 255], [255, 36, 214]];
/** The rainbow colour at a position along the bar (0 to 1). */
function colorAt(v: number): Rgb {
  const t = clamp01(v) * 6, i = Math.min(6, Math.floor(t)), f = t - i, a = STOPS[i], b = STOPS[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

// Puddles as measured on the approved picture (art pixels), and where the picture sits on the 1920 x 1080 stage.
const PUDDLES: { cx: number; cy: number; rx: number; ry: number; c: Rgb; delay: number }[] = [
  { cx: 672, cy: 1010, rx: 158, ry: 30, c: [255, 30, 214], delay: 0 },
  { cx: 933, cy: 1028, rx: 80, ry: 17, c: [255, 150, 10], delay: 900 },
  { cx: 1166, cy: 1036, rx: 124, ry: 22, c: [30, 120, 255], delay: 1700 },
  { cx: 1356, cy: 1005, rx: 130, ry: 25, c: [255, 30, 214], delay: 2600 },
];
const ART = { scale: 0.72, x: 240, y: -10 };
export type StartupStage = { cover: number; left: number; top: number };

function useLoopValue(run: boolean, duration: number, delay = 0) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    value.setValue(0);
    if (!run) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [delay, duration, run, value]);
  return value;
}

function Puddle({ puddle, stage, growth, run }: { puddle: (typeof PUDDLES)[number]; stage: StartupStage; growth: number; run: boolean }) {
  const k = stage.cover * ART.scale;
  const diameter = puddle.rx * 2 * k;
  const flat = puddle.ry / puddle.rx;
  const cx = stage.left + (ART.x + puddle.cx * ART.scale) * stage.cover;
  const cy = stage.top + (ART.y + puddle.cy * ART.scale) * stage.cover;
  const spread = useRef(new Animated.Value(growth)).current;
  // The puddle starts at the size on the picture and spreads as loading advances.
  useEffect(() => {
    Animated.timing(spread, { toValue: growth, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true, isInteraction: false }).start();
  }, [growth, spread]);
  const ripple1 = useLoopValue(run, 4500, puddle.delay);
  const ripple2 = useLoopValue(run, 4500, puddle.delay + 2250);
  const ripple = (v: Animated.Value) => ({
    position: "absolute" as const, left: 0, top: 0, width: diameter, height: diameter, borderRadius: diameter / 2,
    borderWidth: Math.max(1, 2 * k), borderColor: "rgba(255,255,255,.55)",
    opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.4, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.95] }) }],
  });
  const edge = lighten(puddle.c, 60);
  return (
    <Animated.View style={{
      position: "absolute", left: cx - diameter / 2, top: cy - diameter / 2, width: diameter, height: diameter,
      transform: [{ scaleX: spread.interpolate({ inputRange: [0, 1], outputRange: [1, 1.78] }) }, { scaleY: spread.interpolate({ inputRange: [0, 1], outputRange: [flat, flat * 1.55] }) }],
    }}>
      <View style={{ position: "absolute", left: -diameter * 0.45, top: -diameter * 0.45, width: diameter * 1.9, height: diameter * 1.9, borderRadius: diameter, backgroundColor: rgb(puddle.c, 0.07) }} />
      <View style={{ position: "absolute", left: -diameter * 0.2, top: -diameter * 0.2, width: diameter * 1.4, height: diameter * 1.4, borderRadius: diameter, backgroundColor: rgb(puddle.c, 0.16) }} />
      <View style={{ width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: rgb(puddle.c, 0.92), borderWidth: Math.max(1.5, 3 * k), borderColor: rgb(edge, 0.8) }} />
      <View style={{ position: "absolute", left: diameter * 0.2, top: diameter * 0.12, width: diameter * 0.45, height: diameter * 0.45, borderRadius: diameter, backgroundColor: rgb(lighten(puddle.c, 80), 0.3) }} />
      <Animated.View style={ripple(ripple1)} />
      <Animated.View style={ripple(ripple2)} />
    </Animated.View>
  );
}

/** The neon glow around the crown, breathing softly (a 4 second cycle, like the approved design). */
export function BloomLayer({ run, source, style }: { run: boolean; source: ImageSourcePropType; style: ViewStyle }) {
  const breath = useLoopValue(run, 4000);
  return <Animated.Image source={source} resizeMode="stretch" style={[style as object, { opacity: run ? breath.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.15, 0.22, 0.15, 0.08, 0.15] }) : 0.15 }]} />;
}

/** Four puddles of neon paint under the crown. They spread as `growth` (0 to 1) rises. */
export function PuddleLayer({ stage, growth, run }: { stage: StartupStage; growth: number; run: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {PUDDLES.map((puddle, index) => <Puddle key={index} puddle={puddle} stage={stage} growth={growth} run={run} />)}
    </View>
  );
}

/** A rainbow progress bar with a moving shimmer, a glow at the leading edge and a drop of paint that forms, falls and repeats. */
export function ProgressBar({ label, right, percent, unit, run, thick = false }: { label: string; right: string; percent: number; unit: number; run: boolean; thick?: boolean }) {
  const [trackW, setTrackW] = useState(0);
  const height = (thick ? 20 : 10) * unit;
  const text = { fontSize: Math.max(11, 21 * unit) };
  const sheen = useLoopValue(run, 2800);
  const drip = useLoopValue(run, 3100);
  const edgeX = (trackW * percent) / 100;
  const color = colorAt(percent / 100);
  const glow = 44 * unit;
  const r = (1.6 + 3.8) * 0.5 * unit * (thick ? 1.1 : 0.9) + 1.5;
  const showDrop = trackW > 0 && percent > 2 && percent < 99;
  return (
    <View style={{ marginBottom: 14 * unit }}>
      <View style={styles.barLabels}>
        <Text style={[styles.barLabel, text]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.barValue, text]}>{right}</Text>
      </View>
      <View onLayout={(event) => setTrackW(event.nativeEvent.layout.width)}>
        <View style={[styles.track, { height, borderRadius: height / 2 }]}>
          <View style={{ width: `${percent}%`, height, overflow: "hidden", borderRadius: height / 2 }}>
            {trackW > 0 ? <LinearGradient colors={RAINBOW} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: trackW, height }} /> : null}
            <LinearGradient colors={["rgba(255,255,255,.4)", "rgba(255,255,255,0)"]} style={{ position: "absolute", left: 0, right: 0, top: 0, height: height / 2 }} />
            {trackW > 0 ? <Animated.View style={{ position: "absolute", top: 0, width: 120 * unit, height, transform: [{ translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-120 * unit, trackW] }) }] }}>
              <LinearGradient colors={["rgba(255,255,255,0)", "rgba(255,255,255,.55)", "rgba(255,255,255,0)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View> : null}
          </View>
        </View>
        {trackW > 0 ? <View pointerEvents="none" style={{ position: "absolute", left: Math.max(height * 0.6, edgeX) - glow / 2, top: (height - glow) / 2, width: glow, height: glow, borderRadius: glow / 2, backgroundColor: rgb(color, 0.38) }} /> : null}
        {showDrop ? <Animated.View pointerEvents="none" style={{
          position: "absolute", left: edgeX - 2 - r, top: height - 3, width: r * 2, height: r * 2.4, borderRadius: r, backgroundColor: rgb(color),
          opacity: drip.interpolate({ inputRange: [0, 0.03, 0.8, 0.85, 1], outputRange: [0, 1, 1, 0, 0] }),
          transform: [
            { translateY: drip.interpolate({ inputRange: [0, 0.55, 0.85, 1], outputRange: [0, 0, 24 * unit, 24 * unit] }) },
            { scale: drip.interpolate({ inputRange: [0, 0.55], outputRange: [0.25, 1], extrapolateRight: "clamp" }) },
          ],
        }} /> : null}
      </View>
    </View>
  );
}

/** The step the app is on, typed in letter by letter, then animated dots while it works. */
export function TypedTask({ text, unit, run }: { text: string; unit: number; run: boolean }) {
  const [typed, setTyped] = useState(0);
  const [dots, setDots] = useState(1);
  const pulse = useLoopValue(run, 1800);
  useEffect(() => {
    setTyped(0);
    setDots(1);
    let count = 0;
    let dotTimer: ReturnType<typeof setInterval> | undefined;
    const typing = setInterval(() => {
      count += 1;
      setTyped(count);
      if (count >= text.length) {
        clearInterval(typing);
        if (text !== "Ready") dotTimer = setInterval(() => setDots((d) => (d % 3) + 1), 380);
      }
    }, 26);
    return () => { clearInterval(typing); if (dotTimer) clearInterval(dotTimer); };
  }, [text]);
  const shown = text.slice(0, typed) + (typed >= text.length && text !== "Ready" ? ".".repeat(dots) : "");
  return (
    <Animated.Text numberOfLines={1} style={[styles.task, { fontSize: Math.max(13, 27 * unit), opacity: run ? pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.82, 1, 0.82] }) : 1 }]}>
      {shown}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  barLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  barLabel: { color: "rgba(244,236,255,.92)", fontFamily: fonts.semibold, flexShrink: 1 },
  barValue: { color: "rgba(190,215,255,.95)", fontFamily: fonts.semibold },
  track: { backgroundColor: "rgba(255,255,255,.07)", borderWidth: 1, borderColor: "rgba(226,190,255,.30)", overflow: "hidden" },
  task: { color: "#fff", fontFamily: fonts.medium, textAlign: "center", textShadowColor: "rgba(190,120,255,.7)", textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },
});
