import { useStore } from "@/src/store";
import { mediaLibraryPreferences } from "@/src/core/mediaLibrary";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, NativeModules, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";
import { tvColors } from "@/src/theme";
import { useDonation } from "@/src/components/DonationDialog";

/** The host route blurs Live TV before launching the internal native VOD screen. */
export default function VideoOnDemandScreen() {
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
      if (Platform.OS !== "android" || !NativeModules.CharmVod?.openAdaptive) {
        throw new Error("Video OnDemand is available in the Android app.");
      }
      const preferences = await mediaLibraryPreferences();
      const route = await NativeModules.CharmVod.openAdaptive(deviceLayoutMode, section || "home", JSON.stringify(preferences));
      if (route === "medialab:drawer") { router.replace("/"); openDrawer({ focusTop: true }); }
      else if (route === "medialab:donate") showDonation(() => void openVod());
      else if (route === "/settings" || route === "/guide" || route === "/favorites" || route === "/") router.replace(route);
      else router.replace("/");
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
      <View style={styles.content} testID="vod-handoff">
        {!error ? <ActivityIndicator color={tvColors.focus} accessibilityLabel="Opening Video OnDemand" /> : <>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <Pressable disabled={opening} hasTVPreferredFocus={!opening} onPress={() => void openVod()} style={({ focused }: any) => [styles.button, focused && styles.focused]}>
            <Text style={styles.label}>Try again</Text>
          </Pressable>
          <Pressable onPress={() => { router.replace("/"); openDrawer({ focusTop: true }); }} style={({ focused }: any) => [styles.button, focused && styles.focused]}>
            <Text style={styles.label}>Back to MediaLab</Text>
          </Pressable>
        </>}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 12, backgroundColor: tvColors.canvas },
  eyebrow: { color: tvColors.purpleSoft, fontSize: 14, letterSpacing: 3 },
  title: { color: tvColors.text, fontSize: 36, fontWeight: "700" },
  subtitle: { color: tvColors.textMuted, fontSize: 17 },
  error: { color: "#FB7185", fontSize: 16, maxWidth: 600 },
  button: { backgroundColor: tvColors.panelRaised, borderColor: "transparent", borderWidth: 3, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, minWidth: 280 },
  focused: { borderColor: tvColors.focus, backgroundColor: tvColors.purpleDeep },
  label: { color: tvColors.text, fontSize: 17, fontWeight: "600" },
});
