import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, DeviceEventEmitter, Platform, Pressable, requireNativeComponent, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { MediaLabArt } from "@/src/components/MediaLabBrand";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";

const NativeVod = requireNativeComponent<{ style?: any; startSection?: string }>("CharmVodSurface");

/**
 * Unified Charming MediaLab route: ONE MainActivity, ONE player owner.
 * Show a real loading state during decoder release AND native fragment startup.
 * Never remove the branding before the native VOD NavHost reports it is ready.
 */
export default function VideoOnDemandScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const { closeDrawer, openDrawer, focusIconRail } = usePurpleTvDrawer();
  const [ready, setReady] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState("Preparing Video OnDemand...");
  const [waitingLong, setWaitingLong] = useState(false);
  const [retry, setRetry] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    const back = DeviceEventEmitter.addListener("CharmVodRootBack", () => openDrawer({ force: true }));
    const rail = DeviceEventEmitter.addListener("CharmVodFocusHostRail", () => focusIconRail());
    const mode = DeviceEventEmitter.addListener("CharmVodImmersiveChanged", (value: string) => {
      // The player is the only immersive destination; the shell still owns the rail.
      setImmersive(value === "true");
    });
    const mountError = DeviceEventEmitter.addListener("CharmVodMountError", (message: string) => {
      console.error("[CharmVodStartup] Native mount failed:", message);
      setError(message || "The native VOD library could not open.");
      setNativeReady(false);
    });
    const mounted = DeviceEventEmitter.addListener("CharmVodRootReady", (nativeElapsed: string) => {
      const totalMs = Date.now() - startedAt.current;
      console.info("[CharmVodStartup] VOD root ready", { totalMs, nativeElapsed });
      setNativeReady(true);
      setWaitingLong(false);
      setPhase("Ready");
    });
    return () => { back.remove(); rail.remove(); mode.remove(); mountError.remove(); mounted.remove(); };
  }, [focusIconRail, openDrawer]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    startedAt.current = Date.now();
    setError(null);
    setReady(false);
    setNativeReady(false);
    setWaitingLong(false);
    setImmersive(false);
    setPhase("Stopping Live TV playback...");
    void (async () => {
      try {
        closeDrawer({ force: true });
        const releaseStarted = Date.now();
        await stopAllPlaybackSessions("superseded");
        if (cancelled) return;
        console.info("[CharmVodStartup] Live TV released", { releaseMs: Date.now() - releaseStarted });
        setPhase("Opening your VOD library...");
        setReady(true);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not release Live TV playback.");
      }
    })();
    return () => { cancelled = true; setReady(false); setNativeReady(false); setImmersive(false); };
  }, [closeDrawer, retry]));

  useEffect(() => {
    if (nativeReady || error) return;
    const timer = setTimeout(() => setWaitingLong(true), 12_000);
    return () => clearTimeout(timer);
  }, [nativeReady, error, retry, ready]);

  const retryVod = () => setRetry((attempt) => attempt + 1);
  const loading = !nativeReady || Boolean(error) || Platform.OS !== "android";

  return (
    <PurpleTvShell active="/vod" immersiveContent={immersive}>
      <View style={styles.page}>
        {ready && !error && Platform.OS === "android" ? (
          <NativeVod
            style={styles.surface}
            startSection={section === "settings" ? "settings" : "home"}
          />
        ) : null}
        {loading ? (
          <View style={styles.loadingOverlay} testID="charm-vod-loading">
            <MediaLabArt kind="wordmark" width={195} height={90} />
            <Text style={styles.heading}>VIDEO ONDEMAND</Text>
            {error || Platform.OS !== "android" ? (
              <Text style={styles.message}>{error || "Native VOD is supported in the Android TV app."}</Text>
            ) : (
              <>
                <ActivityIndicator color="#C77DFF" size="large" />
                <Text style={styles.message}>{phase}</Text>
                {waitingLong ? (
                  <Text style={styles.hint}>This is taking longer than expected. You can retry without closing Charming MediaLab.</Text>
                ) : null}
              </>
            )}
            {error || waitingLong ? (
              <Pressable onPress={retryVod} accessibilityLabel="Retry Video OnDemand" style={styles.button}>
                <Text style={styles.buttonText}>Retry VOD</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "#10091D" },
  surface: { flex: 1, width: "100%", height: "100%" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#10091D",
    justifyContent: "center",
    alignItems: "center",
    gap: 15,
    padding: 34,
  },
  heading: { color: "#E6C2FF", fontSize: 22, fontWeight: "800", letterSpacing: 3 },
  message: { color: "#FFE7F5", fontSize: 17, textAlign: "center" },
  hint: { color: "#B9A4CC", fontSize: 14, textAlign: "center", maxWidth: 530 },
  button: { backgroundColor: "#60348B", paddingVertical: 14, paddingHorizontal: 22, borderRadius: 13 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
