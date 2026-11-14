import { Dimensions, NativeModules, Platform } from "react-native";
import { setActiveUserAgent } from "../core/userAgent.ts";

export type DeviceLayoutChoice = "auto" | "tv" | "mobile";
type DeviceProfile = { touch?: boolean; leanback?: boolean; keyboard?: boolean; mode?: string; userAgent?: string };

// Every focus call and remote listener keys off Platform.isTV. A real TV
// reports it natively. Other Android devices are decided here:
//   Device layout = TV      -> TV (remote) behaviour
//   Device layout = Mobile  -> touch behaviour
//   Auto                    -> TV when the device is driven by keys (no touch
//                              screen, or a hardware keyboard as on BlueStacks
//                              and Android boxes); touch phones and tablets
//                              get the mobile behaviour.
// This module is imported first by the root layout, before anything reads it.
const nativeTv = Platform.OS !== "web" && !!Platform.isTV;
const device: any = Platform.OS === "android" ? NativeModules.CharmDevice : null;
let profile: DeviceProfile | null = null;
let actsAsTv = nativeTv;

function readProfile(): DeviceProfile | null {
  try { return device?.profileSync ? (device.profileSync() as DeviceProfile) : null; } catch { return null; }
}

/** Pure decision, exported for tests. */
export function decideActsAsTv(mode: DeviceLayoutChoice, info: DeviceProfile | null, wideScreen: boolean): boolean {
  if (mode === "tv") return true;
  if (mode === "mobile") return false;
  // Without the native profile, keep the earlier rule: a wide landscape screen is a TV.
  if (!info) return wideScreen;
  return !!info.leanback || !info.touch || !!info.keyboard;
}

function wideScreen(): boolean {
  const { width, height } = Dimensions.get("screen");
  return width > height && width >= 960;
}

function normalize(mode: unknown): DeviceLayoutChoice {
  return mode === "tv" || mode === "mobile" ? mode : "auto";
}

// The User-Agent chosen in Settings is read before any stream is prepared.
if (Platform.OS === "android") setActiveUserAgent(readProfile()?.userAgent);

if (Platform.OS === "android" && !nativeTv) {
  profile = readProfile();
  actsAsTv = decideActsAsTv(normalize(profile?.mode), profile, wideScreen());
  try {
    Object.defineProperty(Platform, "isTV", { configurable: true, enumerable: true, get: () => actsAsTv });
  } catch { /* the platform object is sealed on this runtime; keep its own answer */ }
}

/**
 * Applies the Device layout setting now and remembers it natively so the next
 * launch starts in that layout. Returns true when the behaviour changed.
 */
export function applyDeviceLayoutChoice(mode: DeviceLayoutChoice): boolean {
  if (Platform.OS !== "android" || nativeTv) return false;
  const choice = normalize(mode);
  try { device?.setLayoutMode?.(choice); } catch { /* remembered in app settings anyway */ }
  const next = decideActsAsTv(choice, profile, wideScreen());
  const changed = next !== actsAsTv;
  actsAsTv = next;
  return changed;
}
