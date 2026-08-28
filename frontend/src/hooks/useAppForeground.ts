import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { isAppUiForeground } from "@/src/core/screenActivity";

/** UI maintenance gate only; native playback keeps its own pause/resume policy. */
export function useAppForeground(): boolean {
  const [foreground, setForeground] = useState(() => isAppUiForeground(AppState.currentState));
  useEffect(() => {
    setForeground(isAppUiForeground(AppState.currentState));
    const sub = AppState.addEventListener("change", state => setForeground(isAppUiForeground(state)));
    return () => sub.remove();
  }, []);
  return foreground;
}
