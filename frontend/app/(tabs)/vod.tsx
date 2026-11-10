import React, { useCallback, useEffect, useRef, useState } from "react";
import { DeviceEventEmitter, Platform, Pressable, requireNativeComponent, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";

const NativeVod = requireNativeComponent<{ style?: any; startSection?: string }>("CharmVodSurface");

/**
 * VOD is a built-in screen of ONE MainActivity, not a second app or splash.
 * Mount the native NavHost immediately instead of gating it on Live TV cleanup.
 * Native navigation must never remount the route or cover it with a black overlay.
 */
export default function VideoOnDemandScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const { closeDrawer, openDrawer, focusIconRail } = usePurpleTvDrawer();
  const [immersive, setImmersive] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Expo Tabs may mount a retained route before it has a real viewport.
  // A FragmentContainerView inserted into a 0x0 Fabric surface cannot draw.
  const [layoutReady, setLayoutReady] = useState(false);
  const enteredAt = useRef(0);

  useEffect(() => {
    const back = DeviceEventEmitter.addListener("CharmVodRootBack", () => openDrawer({ force: true }));
    const rail = DeviceEventEmitter.addListener("CharmVodFocusHostRail", () => focusIconRail());
    const mode = DeviceEventEmitter.addListener("CharmVodImmersiveChanged", (value: string) =>
      setImmersive(value === "true")
    );
    const failure = DeviceEventEmitter.addListener("CharmVodMountError", (message: string) => {
      console.error("[CharmVodStartup] native mount failed", message);
      setMountError(message || "Unable to open the VOD screen.");
    });
    const mounted = DeviceEventEmitter.addListener("CharmVodRootReady", (elapsed: string) => {
      console.info("[CharmVodStartup] embedded VOD is ready", {
        routeMs: Date.now() - enteredAt.current, nativeMs: elapsed,
      });
      setMountError(null);
    });
    return () => { back.remove(); rail.remove(); mode.remove(); failure.remove(); mounted.remove(); };
  }, [focusIconRail, openDrawer]);

  useFocusEffect(useCallback(() => {
    enteredAt.current = Date.now();
    closeDrawer({ force: true });
    // Let the native VOD UI appear immediately. Releasing a Live TV player
    // happens alongside it; catalog navigation does not require a decoder.
    void stopAllPlaybackSessions("superseded").catch((error) => {
      console.warn("[CharmVodStartup] Live TV cleanup failed", error);
    });
    return () => setImmersive(false);
  }, [closeDrawer]));

  return (
    <PurpleTvShell active="/vod" immersiveContent={immersive}>
      <View
        style={styles.page}
        onLayout={({ nativeEvent: { layout } }) => {
          const ready = layout.width > 0 && layout.height > 0;
          setLayoutReady((current) => current === ready ? current : ready);
        }}
      >
        {Platform.OS === "android" && !mountError && layoutReady ? (
          <NativeVod
            key={attempt}
            style={styles.surface}
            startSection={section === "settings" ? "settings" : "home"}
          />
        ) : mountError || Platform.OS !== "android" ? (
          <View style={styles.errorBox}>
            <Text style={styles.message}>{mountError || "Video OnDemand is available in the Android TV app."}</Text>
            {Platform.OS === "android" ? (
              <Pressable
                accessibilityLabel="Retry Video OnDemand"
                onPress={() => { setMountError(null); setAttempt((n) => n + 1); }}
                style={styles.button}
              ><Text style={styles.buttonText}>Retry VOD</Text></Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "#10091D" },
  // Exact fill avoids conflicting flex and percentage dimensions in Fabric.
  surface: { ...StyleSheet.absoluteFillObject },
  errorBox: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, padding: 30 },
  message: { color: "#FFE7F5", fontSize: 17, textAlign: "center" },
  button: { backgroundColor: "#60348B", paddingVertical: 14, paddingHorizontal: 22, borderRadius: 13 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
