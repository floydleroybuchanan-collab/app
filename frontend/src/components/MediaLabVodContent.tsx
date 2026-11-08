import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, findNodeHandle, BackHandler, NativeModules, Platform, Pressable, requireNativeComponent, StyleSheet, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useStore } from "@/src/store";
import { shouldUseTvLayout } from "@/src/utils/tvLayout";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";
import { mediaLibraryPreferences } from "@/src/core/mediaLibrary";
import { captureNativeVodSnapshot } from "@/src/core/vodRecentSnapshot";
import { useAuth } from "@/src/auth/AuthContext";
import { tvColors } from "@/src/theme";
import { usePurpleTvDrawer } from "./PurpleTvShell";
import { useDonation } from "./DonationDialog";
import { MediaLabArt } from "./MediaLabBrand";
import { XtreamProviderBrowser } from "./XtreamProviderBrowser";
import { UnifiedVodOverview } from "./UnifiedVodOverview";

const Surface = Platform.OS === "android" ? requireNativeComponent<any>("CharmVodSurface") : View;
const sections = [["all", "All VOD"], ["home", "Streamflix"], ["movies", "Movies"], ["series", "Series"], ["favorites", "My list"], ["search", "Search"], ["provider-xtream", "Xtream"], ["provider-stalker", "Stalker"]] as const;

function entrySection(value: string, settings: boolean) {
  if (settings) return value;
  return value === "sources" || value === "accounts" || value === "settings" || value === "home" ? "all" : value;
}

/** One app shell; existing native destinations retain their actual controls and providers. */
export function MediaLabVodContent({ initialSection = "home", settings = false, onPlayerChange }: {
  initialSection?: string; settings?: boolean; onPlayerChange?: (playing: boolean) => void;
}) {
  const focused = useIsFocused();
  const router = useRouter();
  const showDonation = useDonation();
  const { openDrawer, closeDrawer } = usePurpleTvDrawer();
  const { deviceLayoutMode } = useStore();
  const { user } = useAuth();
  const accountId = user?.id || null;
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [section, setSection] = useState(() => entrySection(initialSection, settings));
  const providerParts = /^provider:([a-z0-9-]+):(movie|series):([A-Za-z0-9_-]{1,64})$/.exec(section);
  const providerMode = section === "provider" || section === "provider-xtream" || section === "provider-stalker" || !!providerParts;
  const nativeMode = !providerMode && section !== "all";
  const [ready, setReady] = useState(false);
  const captureShelf = useCallback(() => {
    // Called only from the actual native VOD route, never from Live TV home.
    if (!accountId || Platform.OS !== "android" || !focused || !ready || providerMode) return;
    void Promise.all([
      captureNativeVodSnapshot(accountId, "continue"),
      captureNativeVodSnapshot(accountId, "favorites"),
    ]).catch(() => undefined);
  }, [accountId, focused, ready, providerMode]);
  const [player, setPlayer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolbarFocusTag, setToolbarFocusTag] = useState<number | null>(null);
  const bindToolbarEntry = useCallback((node: View | null) => {
    if (node) setToolbarFocusTag(findNodeHandle(node));
  }, []);
  useEffect(() => { setSection(entrySection(initialSection, settings)); }, [initialSection, settings]);
  useEffect(() => {
    let current = true;
    setReady(false);
    setError(null);
    if (focused && nativeMode) void (async () => {
      await stopAllPlaybackSessions("superseded");
      if (!current) return;
      const preferences = await mediaLibraryPreferences();
      if (!current) return;
      await NativeModules.CharmVod?.configureSurface(JSON.stringify(preferences));
      if (current) setReady(true);
    })().catch(() => { if (current) setError("Unable to release playback. Return and try again."); });
    return () => { current = false; onPlayerChange?.(false); };
  }, [focused, nativeMode, onPlayerChange]);
  useEffect(() => {
    if (!focused || !ready || providerMode) return;
    // The native catalog is already mounted. Refresh the tiny display snapshot.
    const timer = setTimeout(captureShelf, 450);
    return () => clearTimeout(timer);
  }, [captureShelf, focused, providerMode, ready]);
  useEffect(() => {
    if (!focused || providerMode) {
      // A timer must never wake the native :vod process after Live TV resumes.
      if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
      snapshotTimer.current = null;
    }
  }, [focused, providerMode]);
  useEffect(() => () => { if (snapshotTimer.current) clearTimeout(snapshotTimer.current); }, []);
  const back = useCallback(() => {
    if (providerMode) { setSection("all"); return; }
    const fallback = () => { if (settings) router.replace("/settings"); else if (nativeMode) setSection("all"); else openDrawer({ focusTop: true }); };
    if (!nativeMode) { fallback(); return; }
    void Promise.resolve(NativeModules.CharmVod?.surfaceBack()).then(handled => {
      if (!handled) fallback();
    }).catch(fallback);
  }, [nativeMode, openDrawer, providerMode, router, settings]);
  useEffect(() => {
    if (!focused || providerMode || !nativeMode) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; });
    return () => listener.remove();
  }, [back, focused, nativeMode, providerMode]);
  return <View style={{ flex: 1, backgroundColor: tvColors.canvas }}>
    {!player && !settings && <View pointerEvents="none" style={styles.banner}><MediaLabArt kind="banner" width={240} height={72} /></View>}
    {!player && <View style={styles.toolbar}>
      {(settings ? [["back", "Back to Settings"]] : [["back", "Back"], ...sections]).map(([value, label]) => <Pressable key={value}
        ref={value === section || (settings && value === "back") ? bindToolbarEntry : undefined}
        onFocus={event => setToolbarFocusTag(event.nativeEvent.target)}
        accessibilityRole="button" accessibilityState={{ selected: value === section || (value === "provider" && providerMode) }}
        onPress={() => {
          if (value === "back") { if (settings) router.replace("/settings"); else back(); return; }
          setError(null);
          setSection(value);
        }}
        style={({ focused: hasFocus, pressed }: any) => [styles.button,
          (value === section || (value === "provider" && providerMode)) && styles.selected,
          hasFocus && styles.focused, pressed && styles.pressed]}>
        <Text style={styles.label}>{label}</Text>
      </Pressable>)}
      {!settings && !providerMode && ready && NativeModules.CharmVod?.surfaceMenu ? <Pressable
        accessibilityRole="button"
        onFocus={event => setToolbarFocusTag(event.nativeEvent.target)}
        onPress={() => { void Promise.resolve(NativeModules.CharmVod.surfaceMenu()).catch(() => setError("Could not open VOD options. Try again.")); }}
        style={({ focused: hasFocus, pressed }: any) => [styles.button, hasFocus && styles.focused, pressed && styles.pressed]}>
        <Text style={styles.label}>Options</Text>
      </Pressable> : null}
    </View>}
    {error ? <Text accessibilityRole="alert" style={{ color: "#FB7185", padding: 20 }}>{error}</Text> : null}
    {focused && nativeMode && !ready && !error && Platform.OS === "android" ? <View style={styles.status}><ActivityIndicator color={tvColors.focus} /><Text style={styles.label}>Opening Video On Demand…</Text></View> : null}
    {focused && nativeMode && Platform.OS !== "android" ? <Text style={styles.status}>The built-in video catalog is available on Android.</Text> : null}
    {focused && section === "all" && !settings ? <UnifiedVodOverview onOpen={setSection} /> : null}
    {providerMode ? <XtreamProviderBrowser allowedProtocol={section === "provider-xtream" ? "xtream" : section === "provider-stalker" ? "stalker" : undefined} initialTitle={providerParts ? { owner: providerParts[1], kind: providerParts[2] as "movie" | "series", catalogId: providerParts[3] } : undefined} onClose={() => setSection("all")} /> : null}
    {focused && ready && nativeMode && Platform.OS === "android" ? <Surface style={{ flex: 1 }} toolbarFocusTag={toolbarFocusTag || 0} section={section} television={shouldUseTvLayout(deviceLayoutMode)}
      onVodEvent={({ nativeEvent }: any) => {
        if (nativeEvent.kind === "error") setError(nativeEvent.value);
        if (nativeEvent.kind === "player") {
          const value = nativeEvent.value === "true";
          setPlayer(value);
          onPlayerChange?.(value);
          if (value) closeDrawer({ force: true });
          if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
          // Start history is recorded during playback; stop/progress may commit
          // slightly after the fragment destination changes.
          if (!value) captureShelf();
          snapshotTimer.current = setTimeout(captureShelf, value ? 2400 : 650);
        }
        if (nativeEvent.kind === "route") {
          // Capture before leaving the native screen; future Live TV display
          // consumes the saved snapshot without launching the :vod process.
          captureShelf();
          if (nativeEvent.value === "medialab:provider-changed") { router.replace("/vod"); return; }
          if (nativeEvent.value === "medialab:donate") { showDonation(); return; }
          if (nativeEvent.value === "/settings") router.replace("/settings");
          else if (nativeEvent.value === "medialab:drawer") openDrawer({ focusTop: true });
          else router.replace("/");
        }
      }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  banner: { alignItems: "center", paddingTop: 4 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5 },
  button: {
    minHeight: 40, maxWidth: "100%", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1,
    borderColor: tvColors.silverEdge, borderTopColor: tvColors.silverHighlight,
    backgroundColor: tvColors.graphiteGlass,
  },
  selected: { backgroundColor: tvColors.violetGlass, borderColor: tvColors.purpleBright },
  focused: { backgroundColor: "rgba(174,122,239,0.38)", borderColor: tvColors.focus, borderTopColor: tvColors.focus },
  pressed: { opacity: 0.76 },
  label: { color: "#F4EDF9", fontSize: 15, fontWeight: "600", textAlign: "center" },
  status: { padding: 18, flexDirection: "row", alignItems: "center", gap: 10, color: tvColors.text },
});
