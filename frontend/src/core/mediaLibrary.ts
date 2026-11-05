import { NativeModules, Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { stopAllPlaybackSessions } from "./playbackSession";
import { router } from "expo-router";

export async function mediaLibraryPreferences() {
  const [audio, subtitle, buffer, size, background, layout] = await Promise.all([
    storage.getItem("gs_audio_default_lang", ""), storage.getItem("gs_subtitle_default_lang", ""),
    storage.getItem("gs_playback_buffer_profile", "stable"), storage.getItem("gs_subtitle_size", "normal"),
    storage.getItem("gs_subtitle_bg", "dim"), storage.getItem("gs_device_layout_mode", "auto"),
  ]);
  return { audio, subtitle, buffer, size, background, layout };
}
/** Every library entry point uses the shared MediaLab screen, including shelves and search. */
export async function openMediaLibrary(section = "home"): Promise<string | null> {
  if (Platform.OS !== "android" || !NativeModules.CharmVod?.configureSurface) throw new Error("This screen requires the Android app.");
  await stopAllPlaybackSessions("superseded");
  router.push({ pathname: section === "settings" || section === "accounts" ? "/vod-settings" : "/vod", params: { section } } as any);
  return null;
}
