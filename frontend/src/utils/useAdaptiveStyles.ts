import { useMemo } from "react";
import { StyleSheet, type TextStyle, type ViewStyle, type ImageStyle } from "react-native";
import { useStore } from "@/src/store";
import { shouldUseTvLayout } from "./tvLayout";

/** Keep television geometry intact while giving handheld screens readable text. */
export function useAdaptiveStyles<T extends StyleSheet.NamedStyles<T>>(base: T, mobile: Partial<Record<keyof T, ViewStyle | TextStyle | ImageStyle>>): T {
  const { deviceLayoutMode } = useStore();
  const handheld = !shouldUseTvLayout(deviceLayoutMode);
  return useMemo(() => {
    if (!handheld) return base;
    return Object.fromEntries(Object.entries(base).map(([key, value]) => {
      const style = value as TextStyle;
      const fontSize = typeof style.fontSize === "number" ? Math.max(14, style.fontSize) : undefined;
      return [key, { ...style, ...(fontSize ? { fontSize, ...(style.lineHeight ? { lineHeight: Math.max(style.lineHeight, Math.ceil(fontSize * 1.3)) } : {}) } : {}), ...mobile[key as keyof T] }];
    })) as T;
  }, [base, handheld, mobile]);
}
