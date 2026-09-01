import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { configureNativeSourceTiming } from "@/src/nativeEpg";

export type SourceTiming = {
  serverOffsetMinutes: number;
  playlistOffsetMinutes: number;
  channelOffsets: Record<string, number>;
};
export type GuideTimingPreferences = { globalOffsetMinutes: number; sources: Record<string, SourceTiming> };

const KEY = "gs_guide_timing_v1";
const EMPTY_SOURCE: SourceTiming = { serverOffsetMinutes: 0, playlistOffsetMinutes: 0, channelOffsets: {} };
let cached: GuideTimingPreferences = { globalOffsetMinutes: 0, sources: {} };
let loaded = false;
let loading: Promise<GuideTimingPreferences> | null = null;
const listeners = new Set<(value: GuideTimingPreferences) => void>();

const clamp = (value: unknown) => Math.max(-1440, Math.min(1440, Math.round(Number(value) || 0)));
function normalize(raw: any): GuideTimingPreferences {
  const sources: Record<string, SourceTiming> = {};
  for (const [id, value] of Object.entries(raw?.sources || {}).slice(0, 12)) {
    if (!/^(default|user(?::[a-z0-9_-]+)?)$/.test(id)) continue;
    const row = value as Partial<SourceTiming>;
    const channelOffsets: Record<string, number> = {};
    for (const [channelId, minutes] of Object.entries(row.channelOffsets || {}).slice(0, 10_000)) {
      if (channelId && !channelId.includes("://")) channelOffsets[channelId.slice(0, 180)] = clamp(minutes);
    }
    sources[id] = { serverOffsetMinutes: clamp(row.serverOffsetMinutes), playlistOffsetMinutes: clamp(row.playlistOffsetMinutes), channelOffsets };
  }
  return { globalOffsetMinutes: clamp(raw?.globalOffsetMinutes), sources };
}
async function load() {
  if (loaded) return cached;
  if (!loading) loading = storage.getItem(KEY, cached).then((value) => { if (!loaded) { cached = normalize(value); loaded = true; } return cached; }).finally(() => { loading = null; });
  return loading;
}
async function syncSource(sourceId: string) {
  const source = cached.sources[sourceId] || EMPTY_SOURCE;
  await configureNativeSourceTiming(sourceId, source.serverOffsetMinutes, source.playlistOffsetMinutes, cached.globalOffsetMinutes, source.channelOffsets);
}
async function commit(next: GuideTimingPreferences, sourceIds: string[]) {
  cached = normalize(next); loaded = true; listeners.forEach((listener) => listener(cached));
  await storage.setItem(KEY, cached);
  await Promise.all(Array.from(new Set(sourceIds)).map(syncSource));
}
export async function getGuideTimingPreferences() { return load(); }
export function useGuideTimingPreferences(sourceId = "default") {
  const [value, setValue] = useState(cached);
  useEffect(() => { let mounted = true; void load().then((next) => mounted && setValue(next)); const listener = (next: GuideTimingPreferences) => mounted && setValue(next); listeners.add(listener); return () => { mounted = false; listeners.delete(listener); }; }, []);
  const source = value.sources[sourceId] || EMPTY_SOURCE;
  const updateSource = useCallback((patch: Partial<SourceTiming>) => {
    void load().then(() => commit({ ...cached, sources: { ...cached.sources, [sourceId]: { ...(cached.sources[sourceId] || EMPTY_SOURCE), ...patch } } }, [sourceId]));
  }, [sourceId]);
  return {
    globalOffsetMinutes: value.globalOffsetMinutes,
    source,
    setGlobalOffsetMinutes: (minutes: number) => void load().then(() => commit({ ...cached, globalOffsetMinutes: clamp(minutes) }, Object.keys(cached.sources).length ? Object.keys(cached.sources) : ["default"])),
    setServerOffsetMinutes: (minutes: number) => updateSource({ serverOffsetMinutes: clamp(minutes) }),
    setPlaylistOffsetMinutes: (minutes: number) => updateSource({ playlistOffsetMinutes: clamp(minutes) }),
    setChannelOffsetMinutes: (channelId: string, minutes: number) => updateSource({ channelOffsets: { ...source.channelOffsets, [channelId]: clamp(minutes) } }),
  };
}
