import { NativeModules, Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { stopAllPlaybackSessions } from "./playbackSession";

export async function mediaLibraryPreferences() {
  const [audio, subtitle, buffer, size, background, layout] = await Promise.all([
    storage.getItem("gs_audio_default_lang", ""), storage.getItem("gs_subtitle_default_lang", ""),
    storage.getItem("gs_playback_buffer_profile", "stable"), storage.getItem("gs_subtitle_size", "normal"),
    storage.getItem("gs_subtitle_bg", "dim"), storage.getItem("gs_device_layout_mode", "auto"),
  ]);
  return { audio, subtitle, buffer, size, background, layout };
}
/** Decoder release is acknowledged before crossing into the native VOD process. */
export async function openMediaLibrary(section = "home"): Promise<string | null> {
  if (Platform.OS !== "android" || !NativeModules.CharmVod?.openAdaptive) throw new Error("This screen requires the Android app.");
  const preferences = await mediaLibraryPreferences();
  await stopAllPlaybackSessions("superseded");
  return NativeModules.CharmVod.openAdaptive(preferences.layout, section, JSON.stringify(preferences));
}
