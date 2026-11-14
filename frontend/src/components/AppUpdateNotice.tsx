import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Constants from "expo-constants";
import { usePathname } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useAppPolicy } from "@/src/core/useAppPolicy";
import { fonts, glass, glassFocus } from "@/src/theme";

/** Lines shown before the rest is folded behind "Show all", so the card fits a TV without scrolling. */
const PREVIEW_LINES = 4;

/** Splits the release note into short lines and drops list markers. */
export function updateNoteLines(message: string): string[] {
  return message
    .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

/** Glass update card: sized to its content, never taller than the screen, scrolls only for a very long note. */
export function AppUpdateNotice() {
  const { update } = useAppPolicy();
  const path = usePathname();
  const shown = useRef(0);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const { width, height } = useWindowDimensions();
  const current = Number(Constants.expoConfig?.android?.versionCode || 0);

  useEffect(() => {
    // Never interrupt a live player, a movie, or multiview with an update prompt.
    if (!["/", "/index", "/home", "/settings"].includes(path)) return;
    if (update.version_code <= current || shown.current === update.version_code || !update.url) return;
    shown.current = update.version_code;
    setAll(false);
    setOpen(true);
  }, [current, path, update]);

  const lines = useMemo(() => updateNoteLines(update.message), [update.message]);
  const folded = lines.length > PREVIEW_LINES + 1 && !all;
  const visible = folded ? lines.slice(0, PREVIEW_LINES) : lines;
  const close = useCallback(() => setOpen(false), []);
  const download = useCallback(() => {
    setOpen(false);
    void Linking.openURL(update.url).catch(() => Alert.alert("Download page unavailable", "Try again from Settings > About."));
  }, [update.url]);

  if (!open) return null;
  // The card never needs more than about three quarters of the screen's height.
  const maxCard = Math.max(260, Math.min(height * 0.8, 560));
  const cardWidth = Math.min(width - 48, 620);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} supportedOrientations={["portrait", "landscape"]}>
      <View style={styles.scrim}>
        <View style={[styles.card, { width: cardWidth, maxHeight: maxCard }]} testID="update-dialog">
          <LinearGradient colors={["rgba(122,62,214,0.42)", "rgba(26,11,51,0.96)"]} style={StyleSheet.absoluteFill} />
          <View style={styles.head}>
            <View style={styles.badge}><Text style={styles.badgeText}>↑</Text></View>
            <View style={styles.headText}>
              <Text style={styles.kicker}>UPDATE AVAILABLE</Text>
              <Text numberOfLines={1} style={styles.title}>Charming MediaLab</Text>
            </View>
            <View style={styles.build}><Text style={styles.buildText}>{current ? `${current} → ${update.version_code}` : `Build ${update.version_code}`}</Text></View>
          </View>
          <ScrollView style={styles.notes} scrollEnabled={all} showsVerticalScrollIndicator={false} focusable={false}>
            {visible.map((line, index) => (
              <View key={`${index}-${line.slice(0, 12)}`} style={styles.noteRow}>
                <Text style={styles.dot}>•</Text>
                <Text numberOfLines={all ? undefined : 2} style={styles.note}>{line}</Text>
              </View>
            ))}
            {folded ? <Text style={styles.more}>+ {lines.length - PREVIEW_LINES} more</Text> : null}
          </ScrollView>
          <View style={styles.actions}>
            {folded ? (
              <Pressable onPress={() => setAll(true)} style={({ focused }: any) => [styles.button, focused && styles.focused]} testID="update-show-all">
                <Text style={styles.buttonText}>Show all</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={close} style={({ focused }: any) => [styles.button, focused && styles.focused]} testID="update-later">
              <Text style={styles.buttonText}>Later</Text>
            </Pressable>
            <Pressable hasTVPreferredFocus onPress={download} style={({ focused }: any) => [styles.button, styles.primary, focused && styles.focused]} testID="update-download">
              <Text style={styles.buttonText}>Open download page</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(7,3,16,0.72)", alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 22, borderWidth: 1, borderColor: glass.edge, overflow: "hidden", padding: 20, gap: 12, backgroundColor: glass.drawer },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headText: { flex: 1, minWidth: 0 },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: glass.selected, borderWidth: 1, borderColor: glass.selectedEdge },
  badgeText: { color: "#fff", fontFamily: fonts.bold, fontSize: 20 },
  kicker: { color: glass.kicker, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.6 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 20 },
  build: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: glass.button, borderWidth: 1, borderColor: glass.buttonEdge },
  buildText: { color: "#EDE3FF", fontFamily: fonts.semibold, fontSize: 12 },
  notes: { flexGrow: 0, flexShrink: 1 },
  noteRow: { flexDirection: "row", gap: 8, paddingVertical: 3 },
  dot: { color: glass.pink, fontSize: 14, lineHeight: 20 },
  note: { flex: 1, color: "#EDE3FF", fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  more: { color: glass.kicker, fontFamily: fonts.medium, fontSize: 12, paddingTop: 4 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" },
  button: { minHeight: 44, paddingHorizontal: 16, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: glass.button, borderWidth: 1, borderColor: glass.buttonEdge },
  primary: { backgroundColor: glass.selected, borderColor: glass.selectedEdge },
  buttonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  focused: { ...glassFocus },
});
