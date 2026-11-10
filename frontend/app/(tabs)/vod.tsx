import React, { useCallback, useEffect, useRef, useState } from "react";
import { DeviceEventEmitter, Platform, Pressable, requireNativeComponent, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";

const NativeVod = requireNativeComponent<{ style?: any; startSection?: string }>("CharmVodSurface");

/**
 * VOD is a built-in screen of ONE MainActivity, not a second app or splash.
 * Mount the native NavHost immediately instead of gating it on Live TV cleanup.
 * Native navigation must never remount the route or cover it with a black overlay.
 */
export default function VideoOnDemandScreen() {
  const { section, screen } = useLocalSearchParams<{ section?: string; screen?: string }>();
  const { closeDrawer, openDrawer, focusIconRail } = usePurpleTvDrawer();
  const router = useRouter();
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const [immersive, setImmersive] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const enteredAt = useRef(0);
  const retryRef = useRef<any>(null);
  const retryFocusedRef = useRef(false);

  // The error replaces the native page, so the remote needs a new home on Retry.
  useEffect(() => {
    if (!mountError) return;
    retryFocusedRef.current = false;
    return requestNativeFocusWithRetry(() => retryRef.current, [0, 60, 160, 320, 640], () => retryFocusedRef.current);
  }, [mountError]);

  useEffect(() => {
    const openDrawerOrReturnToSettings = () => {
      // VOD Settings was opened from the Settings page, so Back returns there.
      if (sectionRef.current === "settings") {
        router.setParams({ section: undefined } as any);
        router.replace("/settings?section=vod" as any);
        return;
      }
      openDrawer({ force: true });
    };
    const back = DeviceEventEmitter.addListener("CharmVodRootBack", () => openDrawerOrReturnToSettings());
    const rail = DeviceEventEmitter.addListener("CharmVodFocusHostRail", () => focusIconRail());
    const guide = DeviceEventEmitter.addListener("CharmVodOpenGuide", () => router.replace("/guide" as any));
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
    return () => { back.remove(); rail.remove(); guide.remove(); mode.remove(); failure.remove(); mounted.remove(); };
  }, [focusIconRail, openDrawer, router]);

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
      <View style={styles.page}>
        {Platform.OS === "android" && !mountError ? (
          // Expo Tabs detach inactive screens, so the native view mounts on attach
          // and tears down on detach without waiting for another JS render.
          <NativeVod
            key={attempt}
            style={styles.surface}
            startSection={section !== "settings" ? "home" : screen && /^screen_[a-z_]+$/.test(screen) ? `settings:${screen}` : "settings"}
          />
        ) : (
          <View style={styles.errorBox}>
            <Text style={styles.message}>{mountError || "Video OnDemand is available in the Android TV app."}</Text>
            {Platform.OS === "android" ? (
              <Pressable
                ref={retryRef}
                focusable
                accessibilityLabel="Retry Video OnDemand"
                onFocus={() => { retryFocusedRef.current = true; }}
                onBlur={() => { retryFocusedRef.current = false; }}
                onPress={() => { setMountError(null); setAttempt((n) => n + 1); }}
                style={({ focused }: any) => [styles.button, focused && styles.buttonFocused]}
              ><Text style={styles.buttonText}>Retry VOD</Text></Pressable>
            ) : null}
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "#10091D" },
  surface: { flex: 1, width: "100%", height: "100%" },
  errorBox: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, padding: 30 },
  message: { color: "#FFE7F5", fontSize: 17, textAlign: "center" },
  button: { backgroundColor: "rgba(150,90,235,0.30)", borderWidth: 1, borderColor: "rgba(226,190,255,0.5)", paddingVertical: 14, paddingHorizontal: 22, borderRadius: 13 },
  buttonFocused: { backgroundColor: "rgba(178,70,255,0.62)", borderColor: "#fff", borderWidth: 2, shadowColor: "#D14DFF", elevation: 16 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
