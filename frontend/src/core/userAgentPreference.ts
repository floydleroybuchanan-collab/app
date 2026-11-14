import { useCallback, useEffect, useState } from "react";
import { NativeModules, Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import {
  nativeUserAgentValue,
  normalizeUserAgentChoice,
  resolveUserAgent,
  setActiveUserAgent,
  type UserAgentChoice,
} from "@/src/core/userAgent";

const KEY = "gs_user_agent_choice";
let value: UserAgentChoice = { preset: "default", custom: "" };
let loaded = false;
let mutationEpoch = 0;
const listeners = new Set<(next: UserAgentChoice) => void>();

function pushToNative(choice: UserAgentChoice): void {
  if (Platform.OS !== "android") return;
  try { (NativeModules.CharmDevice as { setUserAgent?: (v: string) => void } | undefined)?.setUserAgent?.(nativeUserAgentValue(choice)); }
  catch { /* the choice is also saved in app settings */ }
}

/**
 * The User-Agent choice in Settings. It is saved in app storage, mirrored to the
 * native side so playlist, guide and stream requests use it, and applied to the
 * streams the app prepares from now on.
 */
export function useUserAgentPreference(): [UserAgentChoice, (next: UserAgentChoice) => void] {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    let mounted = true;
    const epoch = mutationEpoch;
    if (!loaded) {
      void storage.getItem<UserAgentChoice>(KEY, value).then((stored) => {
        if (loaded || epoch !== mutationEpoch) return;
        value = normalizeUserAgentChoice(stored);
        loaded = true;
        setActiveUserAgent(resolveUserAgent(value));
        pushToNative(value);
        if (mounted) setCurrent(value);
      });
    }
    const listener = (next: UserAgentChoice) => mounted && setCurrent(next);
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);
  return [current, useCallback((next: UserAgentChoice) => {
    mutationEpoch += 1;
    value = normalizeUserAgentChoice(next);
    loaded = true;
    setActiveUserAgent(resolveUserAgent(value));
    pushToNative(value);
    setCurrent(value);
    void storage.setItem(KEY, value);
    for (const listener of Array.from(listeners)) {
      if (!listeners.has(listener)) continue;
      try { listener(value); } catch { /* a settings observer must never break playback */ }
    }
  }, [])];
}
