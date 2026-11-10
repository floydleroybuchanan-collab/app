import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

/** The VOD background: deep violet glass with two soft fluorescent glows. */
export function GlassBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={["#1B0A3C", "#0E0622", "#220B46"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.glow, styles.magenta]} />
      <View style={[styles.glow, styles.cyan]} />
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: "absolute", width: 520, height: 520, borderRadius: 260, opacity: 0.16 },
  magenta: { top: -300, right: -120, backgroundColor: "#E04DFF" },
  cyan: { bottom: -340, left: -80, backgroundColor: "#39B6FF" },
});
