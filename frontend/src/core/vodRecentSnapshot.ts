import { NativeModules, Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { normalizeVodSnapshot, vodSnapshotStorageKey, type VodSnapshotItem, type VodSnapshotKind } from "./vodRecentSnapshotCore";

const subscribers = new Map<string, Set<(items: VodSnapshotItem[]) => void>>();
const pending = new Map<string, Promise<void>>();

/** Never talks to the :vod process. Safe for the Live TV home screen. */
export async function readVodSnapshot(accountId: string | null | undefined, kind: VodSnapshotKind): Promise<VodSnapshotItem[]> {
  const key = vodSnapshotStorageKey(accountId, kind);
  if (!key) return [];
  return normalizeVodSnapshot(await storage.getItem<unknown>(key, []));
}

export function subscribeVodSnapshot(accountId: string | null | undefined, kind: VodSnapshotKind, notify: (items: VodSnapshotItem[]) => void): () => void {
  const key = vodSnapshotStorageKey(accountId, kind);
  if (!key) return () => undefined;
  const listeners = subscribers.get(key) || new Set<(items: VodSnapshotItem[]) => void>();
  listeners.add(notify);
  subscribers.set(key, listeners);
  return () => {
    listeners.delete(notify);
    if (!listeners.size) subscribers.delete(key);
  };
}

/**
 * Call ONLY while the user is already visiting native Streamflix VOD.
 * Fetching through CharmVod on the Live TV home screen can start :vod.
 * Writes are ordered per account and shelf, so a later stop event wins.
 */
export function captureNativeVodSnapshot(accountId: string | null | undefined, kind: VodSnapshotKind): Promise<void> {
  const key = vodSnapshotStorageKey(accountId, kind);
  if (!key || Platform.OS !== "android" || typeof NativeModules.CharmVod?.libraryItems !== "function") return Promise.resolve();
  const previous = pending.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const raw = await NativeModules.CharmVod.libraryItems(kind);
    const items = normalizeVodSnapshot(typeof raw === "string" ? JSON.parse(raw) : raw);
    if (!await storage.setItem(key, items)) throw new Error("Could not save the VOD shelf snapshot.");
    subscribers.get(key)?.forEach(notify => { try { notify(items); } catch {} });
  });
  pending.set(key, next);
  const cleanup = () => { if (pending.get(key) === next) pending.delete(key); };
  next.then(cleanup, cleanup);
  return next;
}
