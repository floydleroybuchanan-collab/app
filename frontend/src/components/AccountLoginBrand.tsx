import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, View } from "react-native";

const icon = require("@/assets/medialab/medialab_login_icon.png");

/** Decorative only: a slow halo, with no moving focus target or background work. */
export function AccountLoginBrand({ size, animate = true }: { size: number; animate?: boolean }) {
  const glow = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    const state = AppState.addEventListener("change", value => setForeground(value === "active"));
    return () => { mounted = false; motion.remove(); state.remove(); };
  }, []);
  useEffect(() => {
    glow.setValue(0);
    if (reduceMotion || !foreground || !animate) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(glow, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [animate, foreground, glow, reduceMotion]);
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
    <Animated.View style={[StyleSheet.absoluteFill, {
      opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [.12, .42] }),
      transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1.01, 1.08] }) }],
    }]}><Image source={icon} blurRadius={22} resizeMode="contain" style={[StyleSheet.absoluteFill, {width:size,height:size}]} /></Animated.View>
    <Image testID="account-login-icon" source={icon} resizeMode="contain" style={[StyleSheet.absoluteFill, {width:size,height:size}]} />
  </View>;
}
