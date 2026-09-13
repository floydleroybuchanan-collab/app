import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
export type MultiviewPreferences = { automaticLayout: boolean; audioFollowsFocus: boolean; hideLabels: boolean; remember: boolean; channelIds: string[] };
const key = "gs_multiview_v2";
let value: MultiviewPreferences = { automaticLayout: true, audioFollowsFocus: false, hideLabels: true, remember: false, channelIds: [] };
let generation = 0;
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
export function loadMultiviewPreferences() {
  if (!loading) { const epoch = generation; loading = storage.getItem<Partial<MultiviewPreferences>>(key, {}).then(raw => {
    const saved = raw || {};
    if (generation !== epoch) return;
    value = { automaticLayout: saved.automaticLayout !== false, audioFollowsFocus: saved.audioFollowsFocus === true,
      hideLabels: saved.hideLabels !== false, remember: saved.remember === true,
      channelIds: Array.isArray(saved.channelIds) ? saved.channelIds.filter((id): id is string => typeof id === "string").slice(0, 4) : [] };
    listeners.forEach(fn => fn());
  }); }
  return loading;
}
export function getMultiviewPreferences() { return value; }
export function updateMultiviewPreferences(change: Partial<MultiviewPreferences>) {
  generation++; value = { ...value, ...change }; void storage.setItem(key, value); listeners.forEach(fn => fn());
}
export function useMultiviewPreferences() {
  const [state, setState] = useState(value);
  useEffect(() => { const fn = () => setState(value); listeners.add(fn); void loadMultiviewPreferences(); return () => { listeners.delete(fn); }; }, []);
  return state;
}
