import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlayerEnginePreference = "media3" | "vlc";

const PLAYER_ENGINE_KEY = "gs_player_engine_preference";
let cachedPreference: PlayerEnginePreference = "media3";
let loaded = false;
let loadPromise: Promise<PlayerEnginePreference> | null = null;
let mutationRevision = 0;
const listeners = new Set<(value: PlayerEnginePreference) => void>();

async function loadPreference(): Promise<PlayerEnginePreference> {
  if (loaded) return cachedPreference;
  if (loadPromise) return loadPromise;
  const revisionAtStart = mutationRevision;
  loadPromise = (async () => {
    const stored = await storage.getItem<string>(PLAYER_ENGINE_KEY, "media3");
    // Older builds used "default". Migrate that deterministically to Media3.
    if (mutationRevision === revisionAtStart) cachedPreference = stored === "vlc" ? "vlc" : "media3";
    loaded = true;
    return cachedPreference;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

void loadPreference().catch(() => undefined);

export function getPlayerEnginePreference(): PlayerEnginePreference {
  return cachedPreference;
}

export async function setPlayerEnginePreference(value: PlayerEnginePreference): Promise<void> {
  mutationRevision += 1;
  cachedPreference = value === "vlc" ? "vlc" : "media3";
  loaded = true;
  await storage.setItem(PLAYER_ENGINE_KEY, cachedPreference);
  for (const listener of Array.from(listeners)) {
    try { listener(cachedPreference); } catch {}
  }
}

export function usePlayerEnginePreference(): [PlayerEnginePreference, (value: PlayerEnginePreference) => void] {
  const [value, setValue] = useState<PlayerEnginePreference>(cachedPreference);
  useEffect(() => {
    let mounted = true;
    void loadPreference().then((next) => { if (mounted) setValue(next); });
    const listener = (next: PlayerEnginePreference) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);
  const update = useCallback((next: PlayerEnginePreference) => {
    const normalized = next === "vlc" ? "vlc" : "media3";
    setValue(normalized);
    void setPlayerEnginePreference(normalized);
  }, []);
  return [value, update];
}
