import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { DEFAULT_ICON_RAIL_PREFERENCES, normalizeIconRailPreferences, type IconRailPreferences } from "./iconRailPolicy";

const KEY = "gs_icon_rail_preferences_v1";
let cached = DEFAULT_ICON_RAIL_PREFERENCES;
let loaded = false;
let loading: Promise<IconRailPreferences> | null = null;
let writes: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
function emit() { listeners.forEach(listener => listener()); }
export async function getIconRailPreferences(): Promise<IconRailPreferences> {
  if (loaded) return cached;
  if (!loading) loading = storage.getItem<IconRailPreferences>(KEY, DEFAULT_ICON_RAIL_PREFERENCES).then(raw => {
    cached = normalizeIconRailPreferences(raw); loaded = true; emit(); return cached;
  }).finally(() => { loading = null; });
  return loading;
}
export function saveIconRailPreferences(patch: Partial<IconRailPreferences>): Promise<void> {
  const next = writes.catch(() => undefined).then(async () => {
    await getIconRailPreferences();
    const value = normalizeIconRailPreferences({ ...cached, ...patch });
    if (!(await storage.setItem(KEY, value))) throw new Error("Could not save rail preferences. Please try again.");
    cached = value; emit();
  });
  writes = next;
  return next;
}
export function useIconRailPreferences() {
  const [state, setState] = useState({ ...cached, ready: loaded });
  useEffect(() => {
    let mounted = true;
    const update = () => { if (mounted) setState({ ...cached, ready: loaded }); };
    listeners.add(update);
    void getIconRailPreferences().then(update).catch(() => { if (mounted) setState({ ...DEFAULT_ICON_RAIL_PREFERENCES, ready: true }); });
    return () => { mounted = false; listeners.delete(update); };
  }, []);
  return state;
}
