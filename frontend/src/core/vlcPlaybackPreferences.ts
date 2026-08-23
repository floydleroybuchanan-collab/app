import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type VlcAudioOutput = "auto" | "stereo" | "passthrough";

type Snapshot = {
  hardwareDecode: boolean;
  audioOutput: VlcAudioOutput;
};

const HW_KEY = "gs_vlc_hardware_decode";
const AUDIO_KEY = "gs_vlc_audio_output";
let cached: Snapshot = { hardwareDecode: true, audioOutput: "auto" };
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
const listeners = new Set<(value: Snapshot) => void>();

function normalizeAudio(raw: unknown): VlcAudioOutput {
  return raw === "stereo" || raw === "passthrough" ? raw : "auto";
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [hardwareDecode, audioOutput] = await Promise.all([
      storage.getItem<boolean>(HW_KEY, true),
      storage.getItem<string>(AUDIO_KEY, "auto"),
    ]);
    cached = {
      hardwareDecode: hardwareDecode !== false,
      audioOutput: normalizeAudio(audioOutput),
    };
    loaded = true;
    return cached;
  })();
  try { return await loadPromise; } finally { loadPromise = null; }
}

void load().catch(() => undefined);

function publish() {
  for (const listener of Array.from(listeners)) {
    try { listener(cached); } catch {}
  }
}

export function getVlcPlaybackPreferences(): Snapshot { return cached; }

export function useVlcPlaybackPreferences(): Snapshot & {
  setHardwareDecode: (value: boolean) => void;
  setAudioOutput: (value: VlcAudioOutput) => void;
} {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => { if (mounted) setValue(next); });
    const listener = (next: Snapshot) => { if (mounted) setValue(next); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);
  return {
    ...value,
    setHardwareDecode: useCallback((next: boolean) => {
      cached = { ...cached, hardwareDecode: !!next };
      loaded = true;
      setValue(cached);
      publish();
      void storage.setItem(HW_KEY, cached.hardwareDecode);
    }, []),
    setAudioOutput: useCallback((next: VlcAudioOutput) => {
      cached = { ...cached, audioOutput: normalizeAudio(next) };
      loaded = true;
      setValue(cached);
      publish();
      void storage.setItem(AUDIO_KEY, cached.audioOutput);
    }, []),
  };
}
