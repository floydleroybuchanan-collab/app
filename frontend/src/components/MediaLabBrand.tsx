import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const art = {
  banner: require("@/assets/medialab/medialab_banner_blend.png"),
  wordmark: require("@/assets/medialab/medialab_wordmark.png"),
  rail: require("@/assets/medialab/medialab_rail.png"),
  circle: require("@/assets/medialab/medialab_launcher.png"),
};

/** Transparent artwork, sized at the use site; all decorations are excluded from TV focus. */
export function MediaLabArt({ kind = "banner", width = 320, height }: {
  kind?: keyof typeof art; width?: number; height?: number;
}) {
  const ratio = kind === "banner" ? 3 : kind === "wordmark" ? 2 : kind === "rail" ? 700 / 960 : 1;
  return <Image accessible accessibilityLabel="Charming MediaLab" source={art[kind]}
    resizeMode="contain" style={{ width, height: height ?? width / ratio, maxWidth: "100%" }} />;
}

export function MediaLabBackdrop({ quiet = false }: { quiet?: boolean }) {
  return <View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
    <LinearGradient colors={["#24112F", "#0C0915", "#110A1D"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    {!quiet && <>
      {[34, 64, 79].map((top, i) => <View key={top} style={[styles.trail, { top: `${top}%`, opacity: .13 + i * .035 }]}>
        <LinearGradient colors={["transparent", "#C056F4", "#F1DDFB", "#9433C7", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: i === 1 ? 2 : 1 }} />
      </View>)}
    </>}
  </View>;
}

/** One finite mount animation; cleanup and reduced motion prevent background animation loops. */
export function MediaLabStartupArt() {
  const value = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(v => { if (mounted) setReduceMotion(v); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (reduceMotion) { value.setValue(0); return; }
    const animation = Animated.sequence(Array.from({ length: 4 }, () => Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 1000, useNativeDriver: true }),
    ])));
    animation.start(); return () => animation.stop();
  }, [reduceMotion, value]);
  return <Animated.View style={{ opacity: value.interpolate({ inputRange: [0, 1], outputRange: [.87, 1] }),
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) }] }}>
    <MediaLabArt kind="circle" width={160} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  trail: { position: "absolute", left: "-10%", right: "-10%", transform: [{ rotate: "-8deg" }] },
});
