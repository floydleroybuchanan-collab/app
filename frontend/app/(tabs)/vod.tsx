import React, { useCallback, useEffect, useState } from "react";
import { DeviceEventEmitter, Platform, Pressable, requireNativeComponent, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";

const NativeVod = requireNativeComponent<{ style?: any; startSection?: string }>("CharmVodSurface");

/**
 * One Charming MediaLab route and ONE MainActivity.
 * The native VOD fragment is mounted *inside* this screen, under the host
 * navigation shell; no second activity, process, splash screen or launcher.
 * Live TV decoders are relinquished before this native surface is mounted.
 */
export default function VideoOnDemandScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const { closeDrawer, openDrawer, focusIconRail } = usePurpleTvDrawer();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    const back = DeviceEventEmitter.addListener("CharmVodRootBack", () => openDrawer({ force: true }));
    const rail = DeviceEventEmitter.addListener("CharmVodFocusHostRail", () => focusIconRail());
    const mode = DeviceEventEmitter.addListener("CharmVodImmersiveChanged", (value: string) =>
      setImmersive(value === "true")
    );
    const mountError = DeviceEventEmitter.addListener("CharmVodMountError", (message: string) => {
      setError(message || "The native VOD library could not open.");
      setReady(false);
    });
    return () => { back.remove(); rail.remove(); mode.remove(); mountError.remove(); };
  }, [focusIconRail, openDrawer]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setError(null);
    setReady(false);
    void (async () => {
      try {
        closeDrawer({ force: true });
        await stopAllPlaybackSessions("superseded");
        if (!cancelled) setReady(true);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not release Live TV playback.");
      }
    })();
    return () => { cancelled = true; setReady(false); setImmersive(false); };
  }, [closeDrawer]));

  return (
    <PurpleTvShell active="/vod" immersiveContent={immersive}>
      <View style={styles.page}>
        {ready && Platform.OS === "android" ? (
          <NativeVod
            style={styles.surface}
            startSection={section === "settings" ? "settings" : "home"}
          />
        ) : error || Platform.OS !== "android" ? (
          <View style={styles.errorBox}>
            <Text style={styles.message}>{error || "Native VOD is supported in the Android TV app."}</Text>
            <Pressable
              onPress={() => { setError(null); void stopAllPlaybackSessions("superseded").then(() => setReady(true)).catch(e => setError(String(e))); }}
              style={styles.button}
            ><Text style={styles.buttonText}>Retry VOD</Text></Pressable>
          </View>
        ) : null}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "#10091D" },
  surface: { flex: 1, width: "100%", height: "100%" },
  errorBox: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, padding: 30 },
  message: { color: "#FFE7F5", fontSize: 17, textAlign: "center" },
  button: { backgroundColor: "#60348B", paddingVertical: 14, paddingHorizontal: 22, borderRadius: 13 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
