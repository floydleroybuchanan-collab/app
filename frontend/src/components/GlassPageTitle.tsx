import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fonts, glass } from "@/src/theme";

/**
 * "Charming MediaLab | Page  KICKER" heading used across the TV pages.
 * Text only (no artwork to decode) and never a remote stop.
 */
export const GlassPageTitle = React.memo(function GlassPageTitle({ page, kicker, style }: {
  page: string;
  kicker?: string;
  style?: object;
}) {
  return (
    <View pointerEvents="none" accessible={false} style={[styles.row, style]}>
      <Text numberOfLines={1} style={styles.brand}>
        Charming <Text style={styles.brandAccent}>MediaLab</Text>
      </Text>
      <View style={styles.bar} />
      <Text numberOfLines={1} style={styles.page}>{page}</Text>
      {kicker ? <Text numberOfLines={1} style={styles.kicker}>{kicker.toUpperCase()}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  brand: { color: "#fff", fontFamily: fonts.bold, fontSize: 15 },
  brandAccent: { color: "#D08CFF" },
  bar: { width: 1, height: 18, backgroundColor: "rgba(255,255,255,0.28)" },
  page: { color: "#fff", fontFamily: fonts.bold, fontSize: 16, flexShrink: 1 },
  kicker: { color: glass.kicker, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1.8, marginLeft: 4, flexShrink: 1 },
});
