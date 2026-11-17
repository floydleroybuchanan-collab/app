import { Platform } from "react-native";
import { useStore } from "@/src/store";
import type { TvCalibration } from "@/src/tvCalibration";

export type DeviceLayoutMode = "auto" | "tv" | "mobile";

/** Resolve whether TV living-room layout should apply. */
export function shouldUseTvLayout(mode: DeviceLayoutMode = "auto"): boolean {
  if (mode === "tv") return true;
  if (mode === "mobile") return false;
  return Platform.OS !== "web" && !!Platform.isTV;
}

/**
 * The live phone/TV decision, for anything that gates WHICH SCREEN OR COMPONENT renders
 * (Channels' phone cards vs the TV list, the Guide's TV-only redirect, VOD's native host, ...).
 *
 * `theme.ts`'s `phoneUi` constant is read once from the native layer at process start and never
 * again; after a Device Layout change in Settings, the app shell (this same `deviceLayoutMode`)
 * updates immediately, but a screen gated on that frozen constant does not, until a real process
 * restart. Depending on how a person "restarts" the app (many relaunches just resume the existing
 * process), that mismatch can last indefinitely and shows as one device's layout mixed with the
 * other's content. This hook reads the same live value the shell itself uses, so there is nothing
 * left to disagree with it. `theme.ts`'s `glass`/`ph` styling tokens stay frozen (changing those
 * live would need every styled screen's StyleSheet moved out of module scope); this hook is only for
 * the handful of places that decide what to render, not how to color or size it.
 */
export function usePhoneUi(): boolean {
  const { deviceLayoutMode } = useStore();
  return !shouldUseTvLayout(deviceLayoutMode);
}

/**
 * Modern Android TV/Fire TV reports the drawable application viewport already.
 * TiViMate-style automatic fit therefore starts full-bleed instead of applying a
 * second guessed safe-area percentage that permanently shrinks 1080p/4K TVs.
 * Real overscan is handled by the user's four-edge calibration layer.
 */
export function getTvSafeInsets(
  _width: number,
  _height: number,
  mode: DeviceLayoutMode = "auto",
) {
  if (!shouldUseTvLayout(mode)) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * Positive calibration = inset an edge. Negative calibration = expand that edge
 * beyond the reported viewport. Applying these values at one layout owner avoids
 * double-letterboxing and never touches player/decoder buffers.
 */
export function combineTvEdgeInsets(
  safe: { top: number; right: number; bottom: number; left: number },
  calibration: TvCalibration,
): {
  padding: { top: number; right: number; bottom: number; left: number };
  margin: { top: number; right: number; bottom: number; left: number };
} {
  const merge = (safeEdge: number, cal: number) => {
    const combined = safeEdge + cal;
    return {
      padding: Math.max(0, combined),
      margin: Math.min(0, combined),
    };
  };
  const top = merge(safe.top, calibration.top);
  const right = merge(safe.right, calibration.right);
  const bottom = merge(safe.bottom, calibration.bottom);
  const left = merge(safe.left, calibration.left);
  return {
    padding: { top: top.padding, right: right.padding, bottom: bottom.padding, left: left.padding },
    margin: { top: top.margin, right: right.margin, bottom: bottom.margin, left: left.margin },
  };
}
