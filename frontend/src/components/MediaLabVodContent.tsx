import React, { useCallback, useEffect, useState } from "react";
import { BackHandler, NativeModules, Platform, Pressable, requireNativeComponent, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useStore } from "@/src/store";
import { shouldUseTvLayout } from "@/src/utils/tvLayout";
import { stopAllPlaybackSessions } from "@/src/core/playbackSession";
import { mediaLibraryPreferences } from "@/src/core/mediaLibrary";
import { tvColors } from "@/src/theme";
import { usePurpleTvDrawer } from "./PurpleTvShell";
import { useDonation } from "./DonationDialog";
import { MediaLabArt } from "./MediaLabBrand";
import { XtreamProviderBrowser } from "./XtreamProviderBrowser";

const Surface = Platform.OS === "android" ? requireNativeComponent<any>("CharmVodSurface") : View;
const sections = [["home", "Browse"], ["movies", "Movies"], ["series", "Series"], ["favorites", "My list"], ["search", "Search"], ["sources", "Sources"], ["provider", "Playlist VOD"]] as const;

/** One app shell; existing native destinations retain their actual controls and providers. */
export function MediaLabVodContent({ initialSection = "home", settings = false, onPlayerChange }: {
  initialSection?: string; settings?: boolean; onPlayerChange?: (playing: boolean) => void;
}) {
  const focused = useIsFocused();
  const router = useRouter();
  const showDonation = useDonation();
  const { openDrawer, closeDrawer } = usePurpleTvDrawer();
  const { deviceLayoutMode } = useStore();
  const [section, setSection] = useState(initialSection);
  const providerParts = /^provider:([a-z0-9-]+):(movie|series):([A-Za-z0-9_-]{1,64})$/.exec(section);
  const providerMode = section === "provider" || !!providerParts;
  const [ready, setReady] = useState(false);
  const [player, setPlayer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSection(initialSection); }, [initialSection]);
  useEffect(() => {
    let current = true;
    setReady(false);
    if (focused) void (async () => {
      await stopAllPlaybackSessions("superseded");
      const preferences = await mediaLibraryPreferences();
      await NativeModules.CharmVod?.configureSurface(JSON.stringify(preferences));
      if (current) setReady(true);
    })().catch(() => { if (current) setError("Unable to release playback. Return and try again."); });
    return () => { current = false; onPlayerChange?.(false); };
  }, [focused, onPlayerChange]);
  const back = useCallback(() => {
    void NativeModules.CharmVod?.surfaceBack().then((handled: boolean) => {
      if (!handled) { if (settings) router.replace("/settings"); else openDrawer({ focusTop: true }); }
    });
  }, [openDrawer, router, settings]);
  useEffect(() => {
    if (!focused || providerMode) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; });
    return () => listener.remove();
  }, [back, focused, providerMode]);
  return <View style={{ flex: 1, backgroundColor: tvColors.canvas }}>
    {!player && !settings && <View pointerEvents="none" style={{ alignItems: "center", paddingTop: 4 }}><MediaLabArt kind="banner" width={240} height={80} /></View>}
    {!player && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 12, paddingVertical: 4 }}>
      {(settings ? [["back", "Back to Settings"]] : [["back", "Back"], ...sections]).map(([value, label]) => <Pressable key={value}
        accessibilityRole="button" accessibilityState={{ selected: value === section }}
        onPress={() => value === "back" ? settings ? router.replace("/settings") : back() : setSection(value)}
        style={({ focused: hasFocus }: any) => ({ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, borderWidth: 2,
          borderColor: hasFocus ? tvColors.focus : "transparent", backgroundColor: value === section ? tvColors.purpleDeep : tvColors.panelRaised })}>
        <Text style={{ color: tvColors.text, fontSize: 15 }}>{label}</Text>
      </Pressable>)}
    </View>}
    {error ? <Text accessibilityRole="alert" style={{ color: "#FB7185", padding: 20 }}>{error}</Text> : null}
    {providerMode ? <XtreamProviderBrowser initialTitle={providerParts ? { owner: providerParts[1], kind: providerParts[2] as "movie" | "series", catalogId: providerParts[3] } : undefined} onClose={() => setSection("home")} /> : null}
    {focused && ready && !providerMode && Platform.OS === "android" ? <Surface style={{ flex: 1 }} section={section} television={shouldUseTvLayout(deviceLayoutMode)}
      onVodEvent={({ nativeEvent }: any) => {
        if (nativeEvent.kind === "error") setError(nativeEvent.value);
        if (nativeEvent.kind === "player") { const value = nativeEvent.value === "true"; setPlayer(value); onPlayerChange?.(value); if (value) closeDrawer({ force: true }); }
        if (nativeEvent.kind === "route") {
          if (nativeEvent.value === "medialab:donate") { showDonation(); return; }
          if (nativeEvent.value === "/settings") router.replace("/settings");
          else if (nativeEvent.value === "medialab:drawer") openDrawer({ focusTop: true });
          else router.replace("/");
        }
      }} /> : null}
  </View>;
}
