import { NativeModules, Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { START_DESTINATIONS } from "./startDestinations";
import { stopAllPlaybackSessions } from "./playbackSession";

/** Single authenticated host entry for VOD and its content-specific settings. */
export async function openMediaLibrary(section = "library"): Promise<string | null> {
  if (Platform.OS !== "android" || !NativeModules.CharmVod?.openSection) throw new Error("This screen requires the Android app.");
  const [audio, subtitle, buffer, size, background, layout] = await Promise.all([
    storage.getItem("gs_audio_default_lang", ""), storage.getItem("gs_subtitle_default_lang", ""),
    storage.getItem("gs_playback_buffer_profile", "stable"), storage.getItem("gs_subtitle_size", "normal"),
    storage.getItem("gs_subtitle_bg", "dim"), storage.getItem("gs_device_layout_mode", "auto"),
  ]);
  await stopAllPlaybackSessions("superseded");
  const destinations = START_DESTINATIONS.filter(item => item.value !== "last_channel").map(({ label, route }) => ({ label, route }));
  return NativeModules.CharmVod.openSection(section, JSON.stringify({ audio, subtitle, buffer, size, background, layout }), JSON.stringify(destinations));
}
