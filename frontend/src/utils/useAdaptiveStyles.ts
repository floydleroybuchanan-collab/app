import { useMemo } from "react";
import { StyleSheet, useWindowDimensions, type TextStyle, type ViewStyle, type ImageStyle } from "react-native";
import { useStore } from "@/src/store";
import { shouldUseTvLayout } from "./tvLayout";

/** Keep television geometry intact while giving handheld screens readable text. */
export function useAdaptiveStyles<T extends StyleSheet.NamedStyles<T>>(base: T, mobile: Partial<Record<keyof T, ViewStyle | TextStyle | ImageStyle>> = {}): T {
  const { deviceLayoutMode } = useStore();
  const handheld = !shouldUseTvLayout(deviceLayoutMode);
  const { width } = useWindowDimensions();
  return useMemo(() => {
    if (!handheld) return base;
    return Object.fromEntries(Object.entries(base).map(([key, value]) => {
      const style = value as TextStyle;
      const fontSize = typeof style.fontSize === "number" ? Math.max(14, style.fontSize) : undefined;
      const control = /(button|action|input|row|chip|choice|toggle|back|key|tile|control)$/i.test(key);
      const geometry: ViewStyle = {};
      if (control) {
        geometry.minHeight = Math.max(48, typeof style.minHeight === "number" ? style.minHeight : 0);
        if (typeof style.height === "number") geometry.height = undefined;
      }
      if (typeof style.width === "number" && style.width > width - 32) geometry.width = Math.max(1, width - 32);
      if (typeof style.minWidth === "number") geometry.minWidth = Math.min(style.minWidth, Math.max(1, width - 32));
      if (style.flexDirection === "row" && /^(header|actions|buttons|choiceRow|row)$/i.test(key)) geometry.flexWrap = "wrap";
      return [key, { ...style, ...geometry, ...(fontSize ? { fontSize, ...(style.lineHeight ? { lineHeight: Math.max(style.lineHeight, Math.ceil(fontSize * 1.3)) } : {}) } : {}), ...mobile[key as keyof T] }];
    })) as T;
  }, [base, handheld, mobile, width]);
}
