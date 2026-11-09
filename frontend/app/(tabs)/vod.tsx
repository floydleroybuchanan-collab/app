import React, { useCallback, useRef, useState } from "react";
import { NativeModules, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";

/**
 * VOD is a first-class Charming MediaLab route: do not render the old
 * "Open Video OnDemand" intermediate page. Android enters its catalog
 * immediately after the host relinquishes the Live TV decoder.
 */
export default function VideoOnDemandScreen() {
  const { closeDrawer, openDrawer } = usePurpleTvDrawer();
  const [error, setError] = useState<string | null>(null);
  const launching = useRef(false);
  const entered = useRef(false);

  const openVod = useCallback(async () => {
    if (launching.current) return;
    launching.current = true;
    setError(null);
    try {
      closeDrawer({ force: true });
      await stopAllPlaybackSessions("superseded");
      if (Platform.OS !== "android" || !NativeModules.CharmVod?.open) {
        throw new Error("Video OnDemand requires the Android app.");
      }
      const result: { openMainDrawer?: boolean } | null = await NativeModules.CharmVod.open();
      // A root VOD BACK always opens the *host* main drawer, never VOD's icon rail.
      if (result?.openMainDrawer) openDrawer();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open Video OnDemand.");
    } finally {
      launching.current = false;
    }
  }, [closeDrawer, openDrawer]);

  useFocusEffect(useCallback(() => {
    if (!entered.current) {
      entered.current = true;
      void openVod();
    }
    return () => { entered.current = false; };
  }, [openVod]));

  // No hero art, duplicate provider chooser, or additional VOD launcher.
  // Only show an actionable fallback on an actual native launch error.
  return (
    <PurpleTvShell active="/vod">
      <View style={styles.canvas}>
        {error ? (
          <View style={styles.errorPanel}>
            <Text style={styles.error}>{error}</Text>
            <Pressable onPress={() => void openVod()} style={styles.retry}>
              <Text style={styles.retryText}>Retry Video OnDemand</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </PurpleTvShell>
  );
}
const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: "#0E091C", justifyContent: "center", alignItems: "center" },
  errorPanel: { backgroundColor: "#241437", borderRadius: 18, padding: 24, alignItems: "center" },
  error: { color: "#FFE6EE", fontSize: 16 },
  retry: { backgroundColor: "#693697", paddingHorizontal: 26, paddingVertical: 14, borderRadius: 12, marginTop: 14 },
  retryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
});
