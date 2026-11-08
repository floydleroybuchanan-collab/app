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
import { PLAYLIST_VOD_ENABLED } from "@/src/core/vodFeatureFlags";

const Surface = Platform.OS === "android" ? requireNativeComponent<any>("CharmVodSurface") : View;
const sections = [["home", "Home"], ["movies", "Movies"], ["series", "Series"], ["favorites", "My List"], ["search", "Search"]] as const;

function entrySection(value: string, settings: boolean) {
  if (settings) return value;
  if (!PLAYLIST_VOD_ENABLED && (value.startsWith("provider:") || value === "provider" || value === "provider-xtream" || value === "provider-stalker")) return "home";
  return value === "sources" || value === "accounts" || value === "settings" || value === "all" ? "home" : value;
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
  const providerMode = PLAYLIST_VOD_ENABLED && (section === "provider" || section === "provider-xtream" || section === "provider-stalker" || !!providerParts);
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
  const [toolbarWidth, setToolbarWidth] = useState(0);
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
    {!player && <View style={styles.toolbar} onLayout={event => {
      const width = Math.round(event.nativeEvent.layout.width);
      if (width !== toolbarWidth) setToolbarWidth(width);
    }}>
      {(() => {
        const actions: { value: string; label: string }[] = settings
          ? [{ value: "back", label: "Back to Settings" }]
          : [{ value: "back", label: "Back" }, ...sections.map(([value, label]) => ({ value, label }))];
        if (!settings && ready && NativeModules.CharmVod?.surfaceMenu) actions.push({ value: "menu", label: "Options" });
        // One row when all buttons fit; otherwise a strict maximum of TWO
        // evenly sized rows. Never allow a third clipped row under the banner.
        const columns = toolbarWidth >= actions.length * 112 + 12
          ? actions.length : Math.ceil(actions.length / 2);
        const rows = [actions.slice(0, columns), actions.slice(columns)].filter(row => row.length);
        return rows.map((row, rowIndex) => <View key={rowIndex} style={styles.toolbarRow}>
          {row.map(({ value, label }) => <Pressable key={value}
            ref={value === section || (settings && value === "back") ? bindToolbarEntry : undefined}
            onFocus={event => setToolbarFocusTag(event.nativeEvent.target)}
            accessibilityRole="button" accessibilityState={{ selected: value === section }}
            onPress={() => {
              if (value === "back") { if (settings) router.replace("/settings"); else back(); return; }
              if (value === "menu") {
                void Promise.resolve(NativeModules.CharmVod?.surfaceMenu?.()).catch(() => setError("Could not open VOD options. Try again."));
                return;
              }
              setError(null);
              setSection(value);
            }}
            style={({ focused: hasFocus, pressed }: any) => [styles.button,
              settings && styles.settingsBackButton,
              value === section && styles.selected,
              hasFocus && styles.focused, pressed && styles.pressed]}>
            <Text style={styles.label} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}>{label}</Text>
          </Pressable>)}
          {row.length < columns && !settings ? Array.from({ length: columns - row.length }, (_, i) =>
            <View key={`empty-${i}`} style={styles.toolbarSpacer} />) : null}
        </View>);
      })()}
    </View>}
    {error ? <Text accessibilityRole="alert" style={{ color: "#FB7185", padding: 20 }}>{error}</Text> : null}
    {focused && nativeMode && !ready && !error && Platform.OS === "android" ? <View style={styles.status}><ActivityIndicator color={tvColors.focus} /><Text style={styles.label}>Opening Video On Demand…</Text></View> : null}
    {focused && nativeMode && Platform.OS !== "android" ? <Text style={styles.status}>The built-in video catalog is available on Android.</Text> : null}
    {PLAYLIST_VOD_ENABLED && providerMode ? <XtreamProviderBrowser allowedProtocol={section === "provider-xtream" ? "xtream" : section === "provider-stalker" ? "stalker" : undefined} initialTitle={providerParts ? { owner: providerParts[1], kind: providerParts[2] as "movie" | "series", catalogId: providerParts[3] } : undefined} onClose={() => setSection("all")} /> : null}
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
          // A playback-start Room commit sends this notification. It is data,
          // NEVER a navigation request: routing it to "/" ejects the player
          // straight back to Live TV as the first movie starts buffering.
          if (nativeEvent.value === "medialab:library-updated") {
            captureShelf();
            return;
          }
          captureShelf();
          if (nativeEvent.value === "medialab:provider-changed") { router.replace("/vod"); return; }
          if (nativeEvent.value === "medialab:donate") { showDonation(); return; }
          if (nativeEvent.value === "/settings") { router.replace("/settings"); return; }
          if (nativeEvent.value === "medialab:drawer") { openDrawer({ focusTop: true }); return; }
          if (nativeEvent.value === "/") { router.replace("/"); return; }
          // Unknown native events must never destroy the active player.
        }
      }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  banner: { alignItems: "center", paddingTop: 4 },
  toolbar: { flexDirection: "column", gap: 4, paddingHorizontal: 10, paddingVertical: 4 },
  toolbarRow: { flexDirection: "row", alignItems: "stretch", gap: 4 },
  settingsBackButton: { flex: 0, minWidth: 0, width: 186, maxWidth: 186, minHeight: 40 },
  toolbarSpacer: { flex: 1, minWidth: 0 },
  button: {
    flex: 1, minWidth: 0, minHeight: 44, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 6, paddingVertical: 6, borderRadius: 12, borderWidth: 1,
    borderColor: tvColors.silverEdge, borderTopColor: tvColors.silverHighlight,
    backgroundColor: tvColors.graphiteGlass,
  },
  selected: { backgroundColor: tvColors.violetGlass, borderColor: tvColors.purpleBright },
  focused: { backgroundColor: "rgba(174,122,239,0.38)", borderColor: tvColors.focus, borderTopColor: tvColors.focus },
  pressed: { opacity: 0.76 },
  label: { color: "#F4EDF9", fontSize: 15, fontWeight: "600", textAlign: "center" },
  status: { padding: 18, flexDirection: "row", alignItems: "center", gap: 10, color: tvColors.text },
});
