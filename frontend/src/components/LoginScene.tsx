import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, View, useWindowDimensions } from "react-native";
import { Image as AnimatedImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

const background = require("@/assets/login/space_bg.jpg");
const angel = require("@/assets/login/angel_hero.png");
// A 12 second seamless loop of the whole scene: wings, arms, hair, stars, shooting stars and the rings from the base.
const sceneLoop = require("@/assets/login/scene_loop.webp");

// Everything is laid out on a 1920 x 1080 stage, exactly as in the approved sign-in design,
// then scaled to cover the screen.
const STAGE_W = 1920;
const STAGE_H = 1080;
const HERO = { x: -42.6, y: -61, w: 1333 * 1.09, h: 1180 * 1.09 };
const STAR_COUNT = 30;

type Star = { x: number; y: number; size: number; period: number; delay: number; tint: string };

function makeStars(): Star[] {
  let seed = 20261114;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  return Array.from({ length: STAR_COUNT }, () => {
    const tint = random();
    return {
      x: random() * STAGE_W,
      y: random() * STAGE_H,
      size: 2 + random() * 4.5,
      period: 1600 + random() * 2600,
      delay: random() * 2400,
      tint: tint < 0.6 ? "#FFFFFF" : tint < 0.85 ? "#B8D4FF" : "#FFC7F0",
    };
  });
}

function TwinklingStar({ star, scale, run }: { star: Star; scale: number; run: boolean }) {
  const value = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    value.setValue(0.25);
    if (!run) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(star.delay),
      Animated.timing(value, { toValue: 1, duration: star.period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(value, { toValue: 0.2, duration: star.period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [run, star, value]);
  const size = star.size * scale;
  return <Animated.View style={{
    position: "absolute", left: star.x * scale, top: star.y * scale, width: size, height: size, borderRadius: size,
    backgroundColor: star.tint, opacity: value, shadowColor: star.tint, shadowOpacity: 0.9, shadowRadius: size * 1.6, elevation: 0,
  }} />;
}

/** A shooting star: crosses from one side to the other every so often. */
function ShootingStar({ scale, run, fromLeft, top, period, delay }: { scale: number; run: boolean; fromLeft: boolean; top: number; period: number; delay: number }) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    value.setValue(0);
    if (!run) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true, isInteraction: false }),
      Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true, isInteraction: false }),
      Animated.delay(period),
    ]));
    animation.start();
    return () => animation.stop();
  }, [delay, period, run, value]);
  const travel = 1000 * scale * (fromLeft ? 1 : -1);
  return <Animated.View style={{
    position: "absolute", top: top * scale, left: (fromLeft ? 60 : STAGE_W - 460) * scale, width: 400 * scale, height: 4 * scale,
    opacity: value.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 1, 0.9, 0] }),
    transform: [{ translateX: value.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }, { rotate: fromLeft ? "14deg" : "-14deg" }],
  }}>
    <LinearGradient colors={fromLeft ? ["rgba(140,120,255,0)", "rgba(200,215,255,.7)", "#FFFFFF"] : ["#FFFFFF", "rgba(200,215,255,.7)", "rgba(140,120,255,0)"]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
  </Animated.View>;
}

/**
 * The sign-in backdrop: space with twinkling and shooting stars, and the angel
 * over the round base. Decorative only: it never takes focus, pauses with the app
 * and stops completely when the viewer has reduce-motion turned on.
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
  const stars = useMemo(makeStars, []);
  const run = animate && !reduceMotion && foreground;
  const scale = Math.max(width / STAGE_W, height / STAGE_H);
  const stageW = STAGE_W * scale;
  const stageH = STAGE_H * scale;
  // On a tall phone screen the angel would sit behind the form, so she is shown only on wide screens.
  const angelVisible = showAngel && width > height;
  // The animated loop replaces the layered picture whenever motion is allowed and the angel is shown.
  const useLoop = run && angelVisible;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <View style={{ position: "absolute", left: (width - stageW) / 2, top: (height - stageH) / 2, width: stageW, height: stageH, overflow: "hidden" }}>
        {useLoop ? <AnimatedImage source={sceneLoop} contentFit="fill" autoplay transition={0}
          style={{ position: "absolute", left: 0, top: 0, width: stageW, height: stageH }} /> : <>
          <Image source={background} resizeMode="cover" style={{ position: "absolute", left: 0, top: 0, width: stageW, height: stageH }} />
          {stars.map((star, index) => <TwinklingStar key={index} star={star} scale={scale} run={run} />)}
          {run ? <>
            <ShootingStar scale={scale} run fromLeft top={150} period={5200} delay={1200} />
            <ShootingStar scale={scale} run fromLeft={false} top={330} period={7600} delay={4200} />
          </> : null}
          {angelVisible ? <Image source={angel} resizeMode="stretch"
            style={{ position: "absolute", left: HERO.x * scale, top: HERO.y * scale, width: HERO.w * scale, height: HERO.h * scale }} /> : null}
        </>}
      </View>
    </View>
  );
}
