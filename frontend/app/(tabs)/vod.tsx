import React, { useCallback, useState } from "react";
import { Platform, Pressable, requireNativeComponent, StyleSheet, Text, View, type NativeSyntheticEvent } from "react-native";
import { useFocusEffect, useIsFocused } from "expo-router";
import { PurpleTvShell, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";
import { tvColors } from "@/src/theme";

type NativePlaybackEvent = NativeSyntheticEvent<{ playing: boolean }>;
type NativeVodProps = {
  active: boolean;
  drawerOpen: boolean;
  style: { flex: number };
  onRequestMainDrawer?: () => void;
  onRequestIconRail?: () => void;
  onPlaybackChanged?: (event: NativePlaybackEvent) => void;
  onVodError?: () => void;
};

// This is a content view inside the same ReactActivity and PurpleTvShell,
// NOT a second VOD activity with its own icon rail and main navigation drawer.
const NativeVodView = Platform.OS === "android"
  ? requireNativeComponent<NativeVodProps>("CharmNativeVod")
  : null;

/** One shared app shell owns the rail timeout, drawers, and navigation across VOD and Live TV. */
export default function VideoOnDemandScreen() {
  const isFocused = useIsFocused();
  const [ready, setReady] = useState(false);
  const [playback, setPlayback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const { drawerOpen, openDrawer, focusIconRail } = usePurpleTvDrawer();

  useFocusEffect(useCallback(() => {
    let live = true;
    setReady(false);
    setPlayback(false);
    setError(null);

    // Release the Live TV decoder before mounting the native VOD fragment and
    // its potential Media3 player. This prevents two large video pipelines from
    // competing for decoder slots and RAM on low-memory TV boxes.
    void stopAllPlaybackSessions("superseded")
      .then(() => { if (live) setReady(true); })
      .catch(() => {
        // Failure to release the previous player must not start a second one.
        if (live) setError("Could not release the previous player. Return to Live TV and try again.");
      });

    return () => {
      live = false;
      setReady(false);
      setPlayback(false);
    };
  }, [retry]));

  const handlePlayback = useCallback((event: NativePlaybackEvent) => {
    setPlayback(event.nativeEvent.playing === true);
  }, []);
  const openMainDrawer = useCallback(() => {
    setPlayback(false);
    openDrawer({ force: true });
  }, [openDrawer]);
  const openSharedRail = useCallback(() => focusIconRail(), [focusIconRail]);
  const handleError = useCallback(() => {
    setError("The VOD catalog could not open. Please try again.");
    setReady(false);
  }, []);

  return (
    <PurpleTvShell active="/vod" suppressIconRail={playback}>
      <View style={styles.content} testID="charming-embedded-vod-page">
        {Platform.OS === "android" && NativeVodView && ready && !error ? (
          <NativeVodView
            key={retry}
            style={styles.native}
            active={isFocused}
            drawerOpen={drawerOpen}
            onRequestMainDrawer={openMainDrawer}
            onRequestIconRail={openSharedRail}
            onPlaybackChanged={handlePlayback}
            onVodError={handleError}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.heading}>Video OnDemand</Text>
            <Text style={styles.details}>{error || (ready ? "VOD requires the Android TV app." : "Preparing your VOD library…")}</Text>
            {error ? (
              <Pressable onPress={() => setRetry(value => value + 1)} style={({ focused }: any) => [styles.retry, focused && styles.retryFocused]}>
                <Text style={styles.retryLabel}>Try Again</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0, backgroundColor: tvColors.canvas },
  native: { flex: 1 },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  heading: { color: tvColors.text, fontSize: 26, fontWeight: "700" },
  details: { color: tvColors.textMuted, fontSize: 16, textAlign: "center" },
  retry: { borderWidth: 2, borderColor: tvColors.lineStrong, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  retryFocused: { borderColor: tvColors.focus, backgroundColor: tvColors.purpleDeep },
  retryLabel: { fontSize: 17, fontWeight: "700", color: tvColors.text },
});
