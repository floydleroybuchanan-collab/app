import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// The crown-in-the-clouds scene: a still background (sky, stars, planet, clouds, the
// crown and the "Charming MediaLab" logo lockup - all baked into one picture) with a
// second "foreground" cutout of just the same crown/logo/planet/clouds shapes (plain
// sky left transparent) layered on top of the animated pieces below. That second
// layer is what makes the meteors genuinely pass BEHIND the crown and the logo
// frame, instead of merely being positioned to avoid them.
const background = require("@/assets/login/scene_bg.webp");
const foreground = require("@/assets/login/scene_foreground.webp");

// Everything is laid out on the scene's own native resolution, then scaled to cover the screen.
const STAGE_W = 3840;
const STAGE_H = 2298;
// The crown's topmost spire catches a bright sparkle highlight in the art - that's
// where the soft "jewel" glow pulse is centered, same trick as before: a translucent
// glow blended on TOP of the art so it reads as the gem itself pulsing.
const JEWEL = { x: 1022, y: 163 };

type PulseStar = { x: number; y: number; size: number; glow: number; delay: number };
const PULSE_STARS: PulseStar[] = [
  { x: 2995.2, y: 275.8, size: 10, glow: 46, delay: 0 },
  { x: 3532.8, y: 643.4, size: 10, glow: 46, delay: 1400 },
  { x: 2304, y: 183.8, size: 10, glow: 46, delay: 2600 },
  { x: 2688, y: 1149, size: 10, glow: 46, delay: 800 },
  { x: 3379.2, y: 1562.6, size: 10, glow: 46, delay: 3400 },
  { x: 3648, y: 1953.3, size: 10, glow: 46, delay: 2000 },
  { x: 921.6, y: 91.9, size: 10, glow: 46, delay: 1800 },
  { x: 652.8, y: 620.5, size: 10, glow: 46, delay: 3100 },
];

type Meteor = { x: number; y: number; angle: string; duration: number; delay: number; tint: "gold" | "ice" };
// "gold" meteors start near the planet (upper-left) and sweep across - the foreground
// cutout above them hides the segments that cross the crown/logo. "ice" meteors stay
// over open sky on the right. Different screen region AND a different timing band, so
// the two groups never overlap or fire together.
const METEORS: Meteor[] = [
  { x: 230.4, y: 68.9, angle: "14deg", duration: 7000, delay: 0, tint: "gold" },
  { x: 460.8, y: 206.8, angle: "20deg", duration: 8200, delay: 4000, tint: "gold" },
  { x: 2227.2, y: 229.8, angle: "16deg", duration: 6800, delay: 2000, tint: "ice" },
  { x: 2496, y: 1263.9, angle: "-14deg", duration: 9200, delay: 6000, tint: "ice" },
];

/** A slow, natural opacity+size breathing loop - used for both the ambient pulsing stars and the crown's jewel. */
function usePulse(run: boolean, delayMs: number, periodMs: number): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    value.setValue(0);
    if (!run) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(delayMs),
      Animated.timing(value, { toValue: 1, duration: periodMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(value, { toValue: 0, duration: periodMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [delayMs, periodMs, run, value]);
  return value;
}

function PulsingStar({ star, scale, run }: { star: PulseStar; scale: number; run: boolean }) {
  const value = usePulse(run, star.delay, 4600);
  const size = star.size * scale;
  const glow = star.glow * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", left: star.x * scale - glow, top: star.y * scale - glow, width: glow * 2, height: glow * 2,
        borderRadius: glow, backgroundColor: "rgba(255,255,255,0.5)",
        opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.95] }),
        transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.15] }) }],
      }}
    >
      <View style={{
        position: "absolute", left: glow - size / 2, top: glow - size / 2, width: size, height: size, borderRadius: size,
        backgroundColor: "#fff", shadowColor: "#fff", shadowOpacity: 0.9, shadowRadius: size * 1.4, elevation: 0,
      }} />
    </Animated.View>
  );
}

/** The crown's own top jewel, pulsing a little brighter now and then - blended on top, soft and additive-looking against the dark sky rather than a hard disc. */
function JewelPulse({ scale, run }: { scale: number; run: boolean }) {
  const value = usePulse(run, 0, 3800);
  const size = 380 * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", left: JEWEL.x * scale - size / 2, top: JEWEL.y * scale - size / 2, width: size, height: size,
        borderRadius: size / 2, backgroundColor: "rgba(210,232,255,0.5)",
        opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
        transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.28] }) }],
        shadowColor: "#BEE0FF", shadowOpacity: 0.8, shadowRadius: size * 0.4, elevation: 0,
      }}
    />
  );
}

const METEOR_TINTS = {
  gold: { colors: ["rgba(255,210,150,0)", "rgba(255,215,160,.55)", "rgba(255,245,220,.95)"], head: "#fff8ec", shadow: "#FFC88C" },
  ice: { colors: ["rgba(180,205,255,0)", "rgba(200,220,255,.55)", "rgba(255,255,255,.95)"], head: "#fff", shadow: "#BEE0FF" },
} as const;

/** A quick realistic streak-and-fade, tapered tail with a bright point head. Loops on its own timer, independent of the others. */
function ShootingMeteor({ meteor, scale, run }: { meteor: Meteor; scale: number; run: boolean }) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    value.setValue(0);
    if (!run) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(meteor.delay),
      Animated.timing(value, { toValue: 1, duration: meteor.duration, easing: Easing.linear, useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [meteor.delay, meteor.duration, run, value]);
  const travel = 840 * scale;
  const tint = METEOR_TINTS[meteor.tint];
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", left: meteor.x * scale, top: meteor.y * scale, width: 260 * scale, height: 4 * scale,
        transform: [
          { rotate: meteor.angle },
          { translateX: value.interpolate({ inputRange: [0, 0.03, 0.22, 0.34, 1], outputRange: [0, travel * 0.02, travel * 0.7, travel, travel] }) },
        ],
        opacity: value.interpolate({ inputRange: [0, 0.03, 0.22, 0.34, 1], outputRange: [0, 1, 1, 0, 0] }),
      }}
    >
      <LinearGradient colors={tint.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <View style={{
        position: "absolute", right: -4 * scale, top: -3 * scale, width: 10 * scale, height: 10 * scale, borderRadius: 6 * scale,
        backgroundColor: tint.head, shadowColor: tint.shadow, shadowOpacity: 1, shadowRadius: 20 * scale, elevation: 0,
      }} />
    </Animated.View>
  );
}

/**
 * The sign-in backdrop: a still crown-in-the-clouds scene (background + the same
 * shapes repeated as a transparent foreground cutout, the "Charming MediaLab" wordmark
 * baked into both) with a handful of small moving pieces sandwiched between the two -
 * meteors that pass genuinely behind the crown/logo, a few slowly pulsing stars, and a
 * soft pulse on the crown's own jewel. Decorative only: it never takes focus, pauses
 * with the app and stops completely when the viewer has reduce-motion on.
 */
export function LoginScene({ animate = true, showAngel = true }: { animate?: boolean; showAngel?: boolean }) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foregroundApp, setForegroundApp] = useState(AppState.currentState !== "background");
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    const state = AppState.addEventListener("change", value => setForegroundApp(value === "active"));
    return () => { mounted = false; motion.remove(); state.remove(); };
  }, []);
  const run = animate && !reduceMotion && foregroundApp;
  const scale = Math.max(width / STAGE_W, height / STAGE_H);
  const stageW = STAGE_W * scale;
  const stageH = STAGE_H * scale;
  // On a tall phone screen the scene would sit behind the form, so it is shown only on wide screens.
  const sceneVisible = showAngel && width > height;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <View style={{ position: "absolute", left: (width - stageW) / 2, top: (height - stageH) / 2, width: stageW, height: stageH, overflow: "hidden" }}>
        <Image source={background} resizeMode="cover" style={{ position: "absolute", left: 0, top: 0, width: stageW, height: stageH }} />
        {sceneVisible && run ? METEORS.map((meteor, index) => <ShootingMeteor key={index} meteor={meteor} scale={scale} run={run} />) : null}
        {sceneVisible ? <Image source={foreground} resizeMode="cover" style={{ position: "absolute", left: 0, top: 0, width: stageW, height: stageH }} /> : null}
        {sceneVisible && run ? PULSE_STARS.map((star, index) => <PulsingStar key={index} star={star} scale={scale} run={run} />) : null}
        {sceneVisible && run ? <JewelPulse scale={scale} run={run} /> : null}
      </View>
    </View>
  );
}
