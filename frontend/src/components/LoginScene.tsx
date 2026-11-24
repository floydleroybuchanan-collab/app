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
const glowSprite = require("@/assets/login/star_glow.png");

// Everything is laid out on the scene's own native resolution, then scaled to cover the screen.
const STAGE_W = 3840;
const STAGE_H = 2298;
// The crown's topmost spire catches a bright sparkle highlight in the art - that's
// where the soft "jewel" glow pulse is centered, same trick as before: a translucent
// glow blended on TOP of the art so it reads as the gem itself pulsing.
const JEWEL = { x: 1022, y: 163 };
// The neon frame around the "Charming MediaLab" lockup, measured off the artwork.
// Two lights chase round it half a lap apart.
const LOGO_FRAME = { x: 365, y: 290, w: 1275, h: 380 };
// The diamond gem above the wordmark: a square path, rotated 45 degrees to trace it.
const GEM_FRAME = { x: -75, y: -75, w: 150, h: 150 };

// Every coordinate below was picked against the actual foreground cutout's alpha
// channel (fully transparent = open sky), and kept left of where the real sign-in
// card sits on a wide screen (roughly the right 45%), so nothing ends up floating on
// top of the form or hidden inside the crown/logo artwork.

type PulseStar = { x: number; y: number; delay: number };
const PULSE_STARS: PulseStar[] = [
  { x: 1739, y: 113, delay: 0 },
  { x: 2258, y: 1302, delay: 1400 },
  { x: 2811, y: 153, delay: 2600 },
  { x: 3179, y: 33, delay: 800 },
  { x: 837, y: 1191, delay: 3400 },
  { x: 472, y: 946, delay: 2000 },
  { x: 1795, y: 321, delay: 1800 },
  { x: 3525, y: 538, delay: 3100 },
];

// A couple of extra "distant moons" - static, no animation needed - purely to give
// the open black area more of a real outer-space feel.
const PLANETS = [
  { x: 2993, y: 91, size: 150, color: "#8FA8E8" },
  { x: 3230, y: 1793, size: 110, color: "#D99CC2" },
];

type Meteor = { x: number; y: number; angle: string; duration: number; delay: number; tint: "gold" | "ice" };
// "gold" meteors start near the planet (upper-left) and sweep across - the foreground
// cutout above them hides the segments that cross the crown/logo. "ice" meteors stay
// clear of the sign-in card on the right. Different screen region AND a different
// timing band, so the two groups never overlap or fire together.
const METEORS: Meteor[] = [
  { x: 165, y: 562, angle: "14deg", duration: 4200, delay: 0, tint: "gold" },
  { x: 1147, y: 50, angle: "20deg", duration: 5000, delay: 1500, tint: "gold" },
  { x: 54, y: 1310, angle: "-10deg", duration: 4600, delay: 2600, tint: "ice" },
  { x: 1600, y: 900, angle: "-16deg", duration: 5400, delay: 3800, tint: "ice" },
  { x: 472, y: 946, angle: "17deg", duration: 4800, delay: 5200, tint: "ice" },
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

/**
 * A soft point-light glow. Stacked flat circles leave visible hard edges, and
 * shadowRadius/elevation renders differently (or not at all) on Android - so this
 * uses a real radial-gradient sprite, tinted, which falls off smoothly and looks
 * identical on every device.
 */
function Glow({ size, color }: { size: number; color: string }) {
  return (
    // The blend lives on the wrapper: additive light, so the glow reads as emitted
    // rather than as a translucent disc painted over the sky. Needs RN >= 0.76 on the
    // New Architecture, which this app runs.
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: -size, top: -size, width: size * 2, height: size * 2, mixBlendMode: "screen" }}
    >
      <Image source={glowSprite} resizeMode="contain" style={{ width: size * 2, height: size * 2, tintColor: color }} />
    </View>
  );
}

/**
 * A light that RUNS AROUND the logo frame's border, like a neon tube chasing its own
 * outline. There is no conic gradient in React Native, so the light is a glow sprite
 * driven around the rectangle's perimeter: one Animated value, interpolated into x
 * and y with the four corners as breakpoints, which keeps the speed constant along
 * every edge and stays on the native driver.
 *
 * It also changes colour as it travels, to match the part of the frame it is crossing
 * - the lockup runs cyan down the left and magenta across the right. Two tinted
 * sprites sit on the same path and cross-fade, because an animated tintColor cannot
 * run on the native driver but opacity can.
 */
function BorderRunner({ rect, scale, run, duration, delay }: {
  rect: { x: number; y: number; w: number; h: number };
  scale: number; run: boolean; duration: number; delay: number;
}) {
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

  const { x, y, w, h } = rect;
  const perimeter = 2 * (w + h);
  // corner breakpoints, as a fraction of the lap
  const topEnd = w / perimeter;
  const rightEnd = (w + h) / perimeter;
  const bottomEnd = (2 * w + h) / perimeter;
  const stops = [0, topEnd, rightEnd, bottomEnd, 1];
  const xs = [x, x + w, x + w, x, x].map(v => v * scale);
  const ys = [y, y, y + h, y + h, y].map(v => v * scale);
  const size = 46 * scale;

  const translateX = value.interpolate({ inputRange: stops, outputRange: xs });
  const translateY = value.interpolate({ inputRange: stops, outputRange: ys });
  // cyan owns the left half of the lap, magenta the right half
  const cyan = value.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.25, 0, 0.25, 1, 0.25] });
  const magenta = value.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.75, 1, 0.75, 0, 0.75] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, transform: [{ translateX }, { translateY }] }}
    >
      <Animated.View style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: cyan }}>
        <Glow size={size} color="#49E8FF" />
      </Animated.View>
      <Animated.View style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: magenta }}>
        <Glow size={size} color="#FF55D4" />
      </Animated.View>
      <Glow size={size * 0.42} color="#FFFFFF" />
    </Animated.View>
  );
}

function PulsingStar({ star, scale, run }: { star: PulseStar; scale: number; run: boolean }) {
  const value = usePulse(run, star.delay, 4600);
  const size = 30 * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", left: star.x * scale, top: star.y * scale, width: 1, height: 1,
        opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
        transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] }) }],
      }}
    >
      <Glow size={size} color="#DCEBFF" />
    </Animated.View>
  );
}

/** The crown's own top jewel, pulsing a little brighter now and then - blended on top, soft and additive-looking against the dark sky rather than a hard disc. */
function JewelPulse({ scale, run }: { scale: number; run: boolean }) {
  const value = usePulse(run, 0, 3800);
  const size = 95 * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", left: JEWEL.x * scale, top: JEWEL.y * scale, width: 1, height: 1,
        opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
        transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.3] }) }],
      }}
    >
      <Glow size={size} color="#D6ECFF" />
    </Animated.View>
  );
}

/** A static soft-glow disc for the extra "distant moon" decorations - no animation needed. */
function Planet({ x, y, size, color, scale }: { x: number; y: number; size: number; color: string; scale: number }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: x * scale, top: y * scale, width: 1, height: 1 }}>
      <Glow size={size * scale} color={color} />
    </View>
  );
}

const METEOR_TINTS = {
  gold: { colors: ["rgba(255,210,150,0)", "rgba(255,215,160,.65)", "rgba(255,245,220,1)"], head: "#fff8ec", glow: "rgba(255,200,140,0.55)" },
  ice: { colors: ["rgba(180,205,255,0)", "rgba(200,220,255,.65)", "rgba(255,255,255,1)"], head: "#fff", glow: "rgba(190,215,255,0.55)" },
} as const;

/** A quick realistic streak-and-fade, tapered tail with a bright glowing head. Loops on its own timer, independent of the others. */
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
  const travel = 1150 * scale;
  const tint = METEOR_TINTS[meteor.tint];
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", left: meteor.x * scale, top: meteor.y * scale, width: 460 * scale, height: 11 * scale,
        transform: [
          { rotate: meteor.angle },
          { translateX: value.interpolate({ inputRange: [0, 0.03, 0.22, 0.34, 1], outputRange: [0, travel * 0.02, travel * 0.7, travel, travel] }) },
        ],
        opacity: value.interpolate({ inputRange: [0, 0.03, 0.22, 0.34, 1], outputRange: [0, 1, 1, 0, 0] }),
      }}
    >
      <LinearGradient colors={tint.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 6 * scale }]} />
      <View style={{ position: "absolute", right: 0, top: 5.5 * scale, width: 1, height: 1 }}>
        <Glow size={34 * scale} color={tint.head} />
      </View>
    </Animated.View>
  );
}

/**
 * The sign-in backdrop: a still crown-in-the-clouds scene (background + the same
 * shapes repeated as a transparent foreground cutout, the "Charming MediaLab" wordmark
 * baked into both) with a handful of small moving pieces sandwiched between the two -
 * meteors that pass genuinely behind the crown/logo, a few slowly pulsing stars, an
 * extra scatter of static stars and distant moons, and a soft pulse on the crown's own
 * jewel. Decorative only: it never takes focus, pauses with the app and stops
 * completely when the viewer has reduce-motion on.
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
        {sceneVisible ? PLANETS.map((planet, index) => <Planet key={index} x={planet.x} y={planet.y} size={planet.size} color={planet.color} scale={scale} />) : null}
        {sceneVisible && run ? METEORS.map((meteor, index) => <ShootingMeteor key={index} meteor={meteor} scale={scale} run={run} />) : null}
        {sceneVisible ? <Image source={foreground} resizeMode="cover" style={{ position: "absolute", left: 0, top: 0, width: stageW, height: stageH }} /> : null}
        {sceneVisible && run ? <BorderRunner rect={LOGO_FRAME} scale={scale} run={run} duration={3400} delay={0} /> : null}
        {sceneVisible && run ? <BorderRunner rect={LOGO_FRAME} scale={scale} run={run} duration={3400} delay={1700} /> : null}
        {sceneVisible && run ? (
          <View pointerEvents="none" style={{
            position: "absolute", left: JEWEL.x * scale, top: (JEWEL.y + 92) * scale,
            width: 1, height: 1, transform: [{ rotate: "45deg" }],
          }}>
            <BorderRunner rect={GEM_FRAME} scale={scale} run={run} duration={2600} delay={600} />
          </View>
        ) : null}
        {sceneVisible && run ? PULSE_STARS.map((star, index) => <PulsingStar key={index} star={star} scale={scale} run={run} />) : null}
        {sceneVisible && run ? <JewelPulse scale={scale} run={run} /> : null}
      </View>
    </View>
  );
}
