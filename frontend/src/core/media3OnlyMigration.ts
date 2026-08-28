export const PLAYER_ENGINE_KEY = "gs_player_engine_preference_v3";
export const RETIRED_ENGINE_KEYS = [
  "gs_player_engine_preference",
  "gs_player_engine_preference_v2",
  "gs_vlc_hardware_decode",
  "gs_vlc_hardware_decode_v2",
  "gs_vlc_audio_output",
] as const;

type PreferenceStorage = {
  setItem: (key: string, value: string) => Promise<boolean>;
  removeItem: (key: string) => Promise<boolean>;
};

/** Only retired player controls are migrated; provider and track data stay intact. */
export async function migrateMedia3OnlyPreferences(storage: PreferenceStorage): Promise<void> {
  await storage.setItem(PLAYER_ENGINE_KEY, "media3");
  for (const key of RETIRED_ENGINE_KEYS) await storage.removeItem(key);
}
