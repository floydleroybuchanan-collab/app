import React, { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { WARM_TAB_MS, warmTabs } from "@/src/core/warmTabs";
import { readDeviceMemoryProfile, shouldUseLowRamTuning } from "@/src/core/deviceMemoryProfile";
import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";

let lowRamDevice = false;
let users = 0;
let teardown: (() => void) | null = null;
/**
 * One set of listeners shared by all tabs while any is mounted: tight memory, the app leaving the
 * screen, or a low-RAM device ends every warm screen. The last tab to unmount removes them.
 */
function acquireGlobals(): () => void {
  users += 1;
  if (users === 1) {
    void readDeviceMemoryProfile().then((profile) => {
      lowRamDevice = shouldUseLowRamTuning(profile);
      if (lowRamDevice) warmTabs.releaseAll();
    }).catch(() => undefined);
    const stopPressure = subscribeAndroidMemoryPressure(() => warmTabs.releaseAll());
    const sub = AppState.addEventListener("change", (state) => { if (state !== "active") warmTabs.releaseAll(); });
    teardown = () => { stopPressure(); sub.remove(); };
  }
  return () => {
    users -= 1;
    if (users === 0) { teardown?.(); teardown = null; warmTabs.releaseAll(); }
  };
}

/**
 * Expo Router tab routes stay mounted after navigation. The real screen subtree is mounted while its
 * tab owns focus. A tab that was just left stays mounted for a short, bounded time (two screens at most,
 * 45 seconds), so jumping back and forth between rail items shows the screen instantly, with no rebuild
 * and no wait for focus. It is released at once on a low-RAM device, under memory pressure, when the app
 * goes to the background, and when another page such as the player opens, so hidden lists, Guide
 * subscriptions and search/database state cannot compete with fullscreen playback.
 */
export function FocusedTabMount({ children }: { children: React.ReactNode }) {
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const visited = useRef(false);
  const [lastFocused, setLastFocused] = useState(isFocused);
  const [retained, setRetained] = useState(false);
  useEffect(() => acquireGlobals(), []);
  if (isFocused) visited.current = true;
  // Decided while rendering, so a screen being left is never unmounted for even one frame.
  if (lastFocused !== isFocused) {
    setLastFocused(isFocused);
    if (isFocused) setRetained(false);
    else {
      const tabs = navigation.getParent();
      setRetained(visited.current && !lowRamDevice && (!tabs || tabs.isFocused()));
    }
  }
  useEffect(() => {
    if (!retained) return;
    const id = {};
    const release = () => setRetained(false);
    warmTabs.add(id, release);
    const timer = setTimeout(() => { warmTabs.remove(id); release(); }, WARM_TAB_MS);
    // Another page (player, multiview, playlists) covering the tabs ends the stay.
    const off = navigation.getParent()?.addListener("blur", () => { warmTabs.remove(id); release(); });
    return () => { clearTimeout(timer); off?.(); warmTabs.remove(id); };
  }, [navigation, retained]);
  return isFocused || retained ? <>{children}</> : null;
}
