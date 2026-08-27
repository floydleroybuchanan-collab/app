import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type VlcAudioOutput = "auto" | "stereo" | "passthrough";

type Snapshot = {
  hardwareDecode: boolean;
  audioOutput: VlcAudioOutput;
};

const HW_KEY = "gs_vlc_hardware_decode";
const AUDIO_KEY = "gs_vlc_audio_output";
// Default off. VLC exists in this app as the manual "compatibility" engine —
// its whole purpose is playing streams/devices Media3 can't. Hardware decode
// failing silently on a given Android TV/Fire TV SoC's MediaCodec is a
// well-known libVLC-Android failure mode: audio keeps playing (a separate,
// unaffected decode path) while video never renders. That directly
// contradicts what users reach for VLC to get. Software decode is slower
// but close to universally correct; users who know their device's hardware
// decoder works can still opt back in from Settings.
let cached: Snapshot = { hardwareDecode: false, audioOutput: "auto" };
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
let hardwareMutationRevision = 0;
let audioMutationRevision = 0;
const listeners = new Set<(value: Snapshot) => void>();

function normalizeAudio(raw: unknown): VlcAudioOutput {
  return raw === "stereo" || raw === "passthrough" ? raw : "auto";
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const hardwareRevisionAtStart = hardwareMutationRevision;
  const audioRevisionAtStart = audioMutationRevision;
  loadPromise = (async () => {
    const [hardwareDecode, audioOutput] = await Promise.all([
      storage.getItem<boolean>(HW_KEY, false),
      storage.getItem<string>(AUDIO_KEY, "auto"),
    ]);
    cached = {
      hardwareDecode: hardwareMutationRevision === hardwareRevisionAtStart ? hardwareDecode === true : cached.hardwareDecode,
      audioOutput: audioMutationRevision === audioRevisionAtStart ? normalizeAudio(audioOutput) : cached.audioOutput,
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
      hardwareMutationRevision += 1;
      cached = { ...cached, hardwareDecode: !!next };
      loaded = true;
      setValue(cached);
      publish();
      void storage.setItem(HW_KEY, cached.hardwareDecode);
    }, []),
    setAudioOutput: useCallback((next: VlcAudioOutput) => {
      audioMutationRevision += 1;
      cached = { ...cached, audioOutput: normalizeAudio(next) };
      loaded = true;
      setValue(cached);
      publish();
      void storage.setItem(AUDIO_KEY, cached.audioOutput);
    }, []),
  };
}
