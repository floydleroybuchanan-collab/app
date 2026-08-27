import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlayerEnginePreference = "media3" | "vlc";

const PLAYER_ENGINE_KEY = "gs_player_engine_preference_v2";
let cachedPreference: PlayerEnginePreference = "vlc";
let loaded = false;
let loadPromise: Promise<PlayerEnginePreference> | null = null;
let mutationRevision = 0;
const listeners = new Set<(value: PlayerEnginePreference) => void>();

async function loadPreference(): Promise<PlayerEnginePreference> {
  if (loaded) return cachedPreference;
  if (loadPromise) return loadPromise;
  const revisionAtStart = mutationRevision;
  loadPromise = (async () => {
    const stored = await storage.getItem<string>(PLAYER_ENGINE_KEY, "vlc");
    // TiViMate-class default is VLC for live IPTV. Older "default"/"media3" keys
    // lived under v1; v2 defaults to VLC so existing installs pick up the live path.
    if (mutationRevision === revisionAtStart) cachedPreference = stored === "media3" ? "media3" : "vlc";
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
