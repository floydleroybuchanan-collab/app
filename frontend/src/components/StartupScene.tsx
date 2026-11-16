import React, { useEffect, useState } from "react";
import { AccessibilityInfo, AppState, Image, StyleSheet, View, useWindowDimensions } from "react-native";
import { Image as AnimatedImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BloomLayer, PuddleLayer } from "@/src/components/StartupEffects";

// Layers, bottom to top: the sky loop (moon glow, twinkling stars, shooting stars); live puddles that spread with the
// real loading progress; the crown picture; its breathing bloom; and the moving parts on a transparent loop (paint
// running down the crown, landing rings, gem sparkles, the light sweep). Both loops are seamless 12 second loops.
const backLoop = require("@/assets/login/startup_back.webp");
const backStill = require("@/assets/login/startup_back_still.jpg");
const art = require("@/assets/login/startup_art.png");
const bloom = require("@/assets/login/startup_bloom.png");
const moveLoop = require("@/assets/login/startup_move.webp");

export const STARTUP_STAGE_W = 1920;
export const STARTUP_STAGE_H = 1080;
// Where the crown picture (2000 x 1125, drawn at 0.72) and the moving layer sit on the 1920 x 1080 stage.
const ART = { x: 240, y: -10, w: 1440, h: 810 };
const MOVE = { x: 240, y: 0, w: 1440, h: 810 };

/** Size of the 1920 x 1080 stage once it covers the screen, and where it sits. */
export function useStartupStage() {
  const { width, height } = useWindowDimensions();
  // A phone held upright is much narrower than the picture. Covering it would cut the crown off at both sides, so
  // the whole scene is scaled to fit the width instead (the crown spans about 700 stage units) and sits in the
  // upper part of the screen. Wide screens (TV, landscape) still cover the whole screen.
  const portrait = height > width * 1.05;
  const cover = portrait ? width / 760 : Math.max(width / STARTUP_STAGE_W, height / STARTUP_STAGE_H);
  const stageW = STARTUP_STAGE_W * cover;
  const stageH = STARTUP_STAGE_H * cover;
  const top = portrait ? Math.max(0, (height - stageH) * 0.32) : (height - stageH) / 2;
  return { width, height, cover, stageW, stageH, left: (width - stageW) / 2, top, portrait };
}

/** Floor colour under the picture on a tall screen (matches the bottom of the sky picture). */
const FLOOR = "#07040F";

/** True when animation is allowed: reduce-motion is off and the app is in the foreground. */
export function useMotionAllowed() {
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState !== "background");
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    const state = AppState.addEventListener("change", value => setForeground(value === "active"));
    return () => { mounted = false; motion.remove(); state.remove(); };
  }, []);
  return !reduceMotion && foreground;
}

/**
 * The loading backdrop: the crown and moon on a star sky, with live puddles. Decorative only:
 * never focusable, still pictures when reduce-motion is on or the app is in the background.
 */
export function StartupScene({ growth }: { growth: number }) {
  const stage = useStartupStage();
  const run = useMotionAllowed();
  const back = { position: "absolute" as const, left: stage.left, top: stage.top, width: stage.stageW, height: stage.stageH };
  const place = (r: { x: number; y: number; w: number; h: number }) => ({ position: "absolute" as const, left: stage.left + r.x * stage.cover, top: stage.top + r.y * stage.cover, width: r.w * stage.cover, height: r.h * stage.cover });
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { backgroundColor: "#000", overflow: "hidden" }]}>
      {stage.portrait && stage.top + stage.stageH < stage.height ? <View style={{ position: "absolute", left: 0, right: 0, top: stage.top + stage.stageH - 1, bottom: 0, backgroundColor: FLOOR }} /> : null}
      {run ? <AnimatedImage source={backLoop} contentFit="fill" autoplay transition={0} style={back} />
        : <Image source={backStill} resizeMode="stretch" style={back} />}
      {stage.portrait ? <>
        <LinearGradient pointerEvents="none" colors={["#000000", "rgba(0,0,0,0)"]} style={{ position: "absolute", left: 0, right: 0, top: stage.top, height: 70 }} />
        <LinearGradient pointerEvents="none" colors={["rgba(7,4,15,0)", FLOOR]} style={{ position: "absolute", left: 0, right: 0, top: stage.top + stage.stageH - 70, height: 70 }} />
      </> : null}
      <PuddleLayer stage={stage} growth={growth} run={run} />
      <Image source={art} resizeMode="stretch" style={place(ART)} />
      <BloomLayer run={run} source={bloom} style={place(ART)} />
      {run ? <AnimatedImage source={moveLoop} contentFit="fill" autoplay transition={0} style={place(MOVE)} /> : null}
    </View>
  );
}
