import { Dimensions, Platform } from "react-native";

// Android boxes and emulators such as BlueStacks report a tablet UI mode even
// though this build is driven with a remote there. Every focus call and remote
// listener keys off Platform.isTV, so a wide landscape screen counts as a TV.
// This module is imported first by the root layout, before anything reads it.
if (Platform.OS === "android" && !Platform.isTV) {
  const { width, height } = Dimensions.get("screen");
  if (width > height && width >= 960) {
    Object.defineProperty(Platform, "isTV", { configurable: true, enumerable: true, get: () => true });
  }
}
