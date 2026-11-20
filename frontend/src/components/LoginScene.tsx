import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// The crown-in-the-clouds scene: a still 1920x1080 background (sky, clouds, stars, the
// "Charming MediaLab" wordmark - all baked in) with the crown as its own transparent
// layer on top, so the handful of moving pieces below (meteors, pulsing stars, the
// crown's own jewel) can sit between the two and pass behind the crown correctly.
const background = require("@/assets/login/scene_bg.webp");
const crown = require("@/assets/login/scene_crown.webp");

// Everything is laid out on a 1920 x 1080 stage, then scaled to cover the screen.
const STAGE_W = 1920;
const STAGE_H = 1080;
const CROWN = { x: 1, y: -78, w: 1150, h: 1150 };
const JEWEL = { x: 589.4, y: 251.6 };

type PulseStar = { x: number; y: number; size: number; glow: number; delay: number };
const PULSE_STARS: PulseStar[] = [
  { x: 1497.6, y: 151.2, size: 5, glow: 23, delay: 0 },
  { x: 1728, y: 496.8, size: 5, glow: 23, delay: 1600 },
  { x: 1305.6, y: 734.4, size: 5, glow: 23, delay: 3000 },
  { x: 230.4, y: 54, size: 5, glow: 23, delay: 2300 },
  { x: 96, y: 21.6, size: 5, glow: 23, delay: 4100 },
];

type Meteor = { x: number; y: number; angle: string; duration: number; delay: number };
const METEORS: Meteor[] = [
  { x: 115.2, y: 216, angle: "18deg", duration: 6500, delay: 400 },
  { x: 883.2, y: 129.6, angle: "14deg", duration: 8200, delay: 3600 },
  { x: 38.4, y: 345.6, angle: "8deg", duration: 7400, delay: 1800 },
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

/** The crown's own top jewel, pulsing a little brighter now and then - blended by keeping it soft and additive-looking against the dark sky rather than a hard disc. */
function JewelPulse({ scale, run }: { scale: number; run: boolean }) {
  const value = usePulse(run, 0, 3800);
  const size = 190 * scale;
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
  const travel = 420 * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", left: meteor.x * scale, top: meteor.y * scale, width: 130 * scale, height: 2 * scale,
        transform: [
          { rotate: meteor.angle },
          { translateX: value.interpolate({ inputRange: [0, 0.03, 0.22, 0.34, 1], outputRange: [0, travel * 0.02, travel * 0.7, travel, travel] }) },
        ],
        opacity: value.interpolate({ inputRange: [0, 0.03, 0.22, 0.34, 1], outputRange: [0, 1, 1, 0, 0] }),
      }}
    >
      <LinearGradient colors={["rgba(180,205,255,0)", "rgba(200,220,255,.55)", "rgba(255,255,255,.95)"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <View style={{
        position: "absolute", right: -2 * scale, top: -1.5 * scale, width: 5 * scale, height: 5 * scale, borderRadius: 3 * scale,
        backgroundColor: "#fff", shadowColor: "#BEE0FF", shadowOpacity: 1, shadowRadius: 10 * scale, elevation: 0,
      }} />
    </Animated.View>
  );
}

/**
 * The sign-in backdrop: a still crown-in-the-clouds scene (background + crown, the
 * "Charming MediaLab" wordmark baked into the background) with a handful of small
 * moving pieces on top - meteors that pass behind the crown, a few slowly pulsing
 * stars, and a soft pulse on the crown's own jewel. Decorative only: it never takes
 * focus, pauses with the app and stops completely when the viewer has reduce-motion on.
 */
export function LoginScene({ animate = true, showAngel = true }: { animate?: boolean; showAngel?: boolean }) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState !== "background");
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    const state = AppState.addEventListener("change", value => setForeground(value === "active"));
    return () => { mounted = false; motion.remove(); state.remove(); };
  }, []);
  const run = animate && !reduceMotion && foreground;
  const scale = Math.max(width / STAGE_W, height / STAGE_H);
  const stageW = STAGE_W * scale;
  const stageH = STAGE_H * scale;
  // On a tall phone screen the crown would sit behind the form, so it is shown only on wide screens.
  const crownVisible = showAngel && width > height;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <View style={{ position: "absolute", left: (width - stageW) / 2, top: (height - stageH) / 2, width: stageW, height: stageH, overflow: "hidden" }}>
        <Image source={background} resizeMode="cover" style={{ position: "absolute", left: 0, top: 0, width: stageW, height: stageH }} />
        {crownVisible && run ? METEORS.map((meteor, index) => <ShootingMeteor key={index} meteor={meteor} scale={scale} run={run} />) : null}
        {crownVisible && run ? PULSE_STARS.map((star, index) => <PulsingStar key={index} star={star} scale={scale} run={run} />) : null}
        {crownVisible ? <Image source={crown} resizeMode="contain"
          style={{ position: "absolute", left: CROWN.x * scale, top: CROWN.y * scale, width: CROWN.w * scale, height: CROWN.h * scale }} /> : null}
        {crownVisible && run ? <JewelPulse scale={scale} run={run} /> : null}
      </View>
    </View>
  );
}
