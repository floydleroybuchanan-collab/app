import { useStore } from "@/src/store";
import { mediaLibraryPreferences } from "@/src/core/mediaLibrary";
import { MediaLabArt, MediaLabBackdrop } from "@/src/components/MediaLabBrand";
import React, { useCallback, useRef, useState } from "react";
import { NativeModules, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";
import { tvColors } from "@/src/theme";
import { useDonation } from "@/src/components/DonationDialog";

/** The host route blurs Live TV before launching the internal native VOD screen. */
export default function VideoOnDemandScreen() {
  const { width, height } = useWindowDimensions();
  const { deviceLayoutMode } = useStore();
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launching = useRef(false);
  const entered = useRef(false);
  const { closeDrawer, openDrawer } = usePurpleTvDrawer();
  const showDonation = useDonation();

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
      const preferences = await mediaLibraryPreferences();
      const route = await NativeModules.CharmVod.openAdaptive(deviceLayoutMode, section || "home", JSON.stringify(preferences));
      if (route === "medialab:drawer") openDrawer({ focusTop: true });
      else if (route === "medialab:donate") showDonation(() => void openVod());
      else if (route === "/settings" || route === "/guide" || route === "/favorites" || route === "/") router.replace(route);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open Video OnDemand.");
    } finally {
      launching.current = false;
      setOpening(false);
    }
  }, [closeDrawer, deviceLayoutMode, section, openDrawer, router, showDonation]);

  useFocusEffect(useCallback(() => {
    if (!entered.current) {
      entered.current = true;
      void openVod();
    }
    return () => { entered.current = false; };
  }, [openVod]));

  return (
    <PurpleTvShell active="/vod">
      <View style={styles.content}><MediaLabBackdrop />
        <MediaLabArt width={Math.min(width - 56, height * .75, 600)} />
        <Text style={styles.title}>Video OnDemand</Text>
        <Text style={styles.subtitle}>{opening ? "Opening your VOD library…" : "Movies, series, search, favorites and continue watching."}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={{ flexDirection: width > 800 ? "row" : "column", gap: 12 }}>
        <Pressable disabled={opening} hasTVPreferredFocus={!opening} onPress={() => void openVod()} style={({ focused }: any) => [styles.button, focused && styles.focused]}>
          <Text style={styles.label}>{opening ? "Opening…" : "Open Video OnDemand"}</Text>
        </Pressable>
        <Pressable onPress={() => openDrawer({ focusTop: true })} style={({ focused }: any) => [styles.button, focused && styles.focused]}>
          <Text style={styles.label}>Charming MediaLab TV</Text>
        </Pressable></View>
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 12 },
  eyebrow: { color: tvColors.purpleSoft, fontSize: 14, letterSpacing: 3 },
  title: { color: tvColors.text, fontSize: 36, fontWeight: "700" },
  subtitle: { color: tvColors.textMuted, fontSize: 17 },
  error: { color: "#FB7185", fontSize: 16, maxWidth: 600 },
  button: { backgroundColor: tvColors.panelRaised, borderColor: "transparent", borderWidth: 3, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, minWidth: 280 },
  focused: { borderColor: tvColors.focus, backgroundColor: tvColors.purpleDeep },
  label: { color: tvColors.text, fontSize: 17, fontWeight: "600" },
});
