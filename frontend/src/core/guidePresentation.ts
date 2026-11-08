import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

/**
 * Original guide behavior, independently implemented for Charming MediaLab.
 * Overlay transparency setting 0..100 maps to 0..50% transparency.
 * Preview backgrounds are always opaque; Media3 video has its own surface.
 */
export type GuidePresentationMode = "overlay" | "preview";
export type GuidePresentation = {
  mode: GuidePresentationMode;
  transparency: number;
  animate: boolean;
  autoplayOnFocus: boolean;
  stayInGuide: boolean;
};
export const GUIDE_PRESENTATION_KEY = "charm_guide_presentation_v1";
export const DEFAULT_GUIDE_PRESENTATION: Readonly<GuidePresentation> = Object.freeze({
  mode: "overlay",
  transparency: 50,
  animate: true,
  autoplayOnFocus: false,
  stayInGuide: true,
});
export const clampTransparency = (value: unknown) =>
  Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
export const overlayOpacity = (level: number) =>
  1 - clampTransparency(level) * 0.005;
export const guidePanelOpacity = (mode: GuidePresentationMode, level: number) =>
  mode === "preview" ? 1 : overlayOpacity(level);

const normalize = (value: Partial<GuidePresentation> | null | undefined): GuidePresentation => ({
  mode: value?.mode === "preview" ? "preview" : "overlay",
  transparency: clampTransparency(value?.transparency ?? 50),
  animate: value?.animate !== false,
  autoplayOnFocus: value?.autoplayOnFocus === true,
  stayInGuide: value?.stayInGuide !== false,
});
let cached: GuidePresentation = { ...DEFAULT_GUIDE_PRESENTATION };
let loaded = false;
let loadPromise: Promise<GuidePresentation> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: GuidePresentation) => void>();
async function load(): Promise<GuidePresentation> {
  if (loaded) return cached;
  if (!loadPromise) {
    const initialEpoch = mutationEpoch;
    loadPromise = storage.getItem<GuidePresentation>(GUIDE_PRESENTATION_KEY, cached).then((saved) => {
      if (!loaded && mutationEpoch === initialEpoch) {
        cached = normalize(saved);
        loaded = true;
        for (const listener of listeners) listener(cached);
      }
      return cached;
    }).finally(() => { loadPromise = null; });
  }
  return loadPromise;
}
export function updateGuidePresentation(patch: Partial<GuidePresentation>): void {
  mutationEpoch++;
  cached = normalize({ ...cached, ...patch });
  loaded = true;
  for (const listener of listeners) listener(cached);
  void storage.setItem(GUIDE_PRESENTATION_KEY, cached).catch(() => undefined);
}
export function useGuidePresentation() {
  const [value, setValue] = useState<GuidePresentation>(cached);
  useEffect(() => {
    let active = true;
    void load().then((next) => { if (active) setValue(next); });
    const listen = (next: GuidePresentation) => { if (active) setValue(next); };
    listeners.add(listen);
    return () => { active = false; listeners.delete(listen); };
  }, []);
  const change = useCallback((patch: Partial<GuidePresentation>) => updateGuidePresentation(patch), []);
  return { ...value, change };
}

/** Only offer dates supported by the currently retained EPG window. */
export function availableGuideDays(start: string, end: string): Array<{ key: string; label: string; at: number }> {
  const from = Date.parse(start), to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const first = new Date(from); first.setHours(0, 0, 0, 0);
  const days: Array<{ key: string; label: string; at: number }> = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let cursor = first.getTime(), n = 0; cursor < to && n < 15; n++) {
    if (cursor + 86400000 > from) {
      const stamp = new Date(cursor);
      const delta = Math.round((cursor - today.getTime()) / 86400000);
      const label = delta === -1 ? "Yesterday" : delta === 0 ? "Today" : delta === 1 ? "Tomorrow"
        : stamp.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      days.push({ key: stamp.toDateString(), label, at: Math.max(from, cursor) });
    }
    const next = new Date(cursor); next.setDate(next.getDate() + 1);
    cursor = next.getTime();
  }
  return days;
}
