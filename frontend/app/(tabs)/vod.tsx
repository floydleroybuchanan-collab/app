import React, { useCallback, useRef, useState } from "react";
import { NativeModules, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";
import { tvColors } from "@/src/theme";

/** The host route blurs Live TV before launching the internal native VOD screen. */
export default function VideoOnDemandScreen() {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launching = useRef(false);
  const entered = useRef(false);
  const { closeDrawer, openDrawer } = usePurpleTvDrawer();

  const openVod = useCallback(async () => {
    if (launching.current) return;
    launching.current = true;
    setOpening(true);
    setError(null);
    try {
      closeDrawer({ force: true });
      // Acknowledge decoder release instead of racing a second player against Live TV.
      await stopAllPlaybackSessions("superseded");
      if (Platform.OS !== "android" || !NativeModules.CharmVod?.open) {
        throw new Error("Video OnDemand is available in the experimental Android APK.");
      }
      await NativeModules.CharmVod.open();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open Video OnDemand.");
    } finally {
      launching.current = false;
      setOpening(false);
    }
  }, [closeDrawer]);

  useFocusEffect(useCallback(() => {
    if (!entered.current) {
      entered.current = true;
      void openVod();
    }
    return () => { entered.current = false; };
  }, [openVod]));

  return (
    <PurpleTvShell active="/vod">
      <View style={styles.content}>
        <Text style={styles.eyebrow}>CHARMIPTV</Text>
        <Text style={styles.title}>Video OnDemand</Text>
        <Text style={styles.subtitle}>{opening ? "Opening your VOD library…" : "Movies, series, search, favorites and continue watching."}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable disabled={opening} hasTVPreferredFocus={!opening} onPress={() => void openVod()} style={({ focused }: any) => [styles.button, focused && styles.focused]}>
          <Text style={styles.label}>{opening ? "Opening…" : "Open Video OnDemand"}</Text>
        </Pressable>
        <Pressable onPress={() => openDrawer({ focusTop: true })} style={({ focused }: any) => [styles.button, focused && styles.focused]}>
          <Text style={styles.label}>CharmIPTV menu</Text>
        </Pressable>
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", alignItems: "flex-start", padding: 48, gap: 16 },
  eyebrow: { color: tvColors.purpleSoft, fontSize: 14, letterSpacing: 3 },
  title: { color: tvColors.text, fontSize: 36, fontWeight: "700" },
  subtitle: { color: tvColors.textMuted, fontSize: 17 },
  error: { color: "#FB7185", fontSize: 16, maxWidth: 600 },
  button: { backgroundColor: tvColors.panelRaised, borderColor: "transparent", borderWidth: 3, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, minWidth: 280 },
  focused: { borderColor: tvColors.focus, backgroundColor: tvColors.purpleDeep },
  label: { color: tvColors.text, fontSize: 17, fontWeight: "600" },
});
