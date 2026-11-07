import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { mergeProviderLibrary, normalizeProviderLibrary, type ProviderLibraryEntry } from "./providerLibraryCore";
export const PROVIDER_LIBRARY_STORAGE_KEY = "gs_provider_library_v1";
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<(rows: ProviderLibraryEntry[]) => void>();
export async function readProviderLibrary(): Promise<ProviderLibraryEntry[]> { return normalizeProviderLibrary(await storage.getItem(PROVIDER_LIBRARY_STORAGE_KEY, [])); }
export function updateProviderLibrary(patch: Partial<ProviderLibraryEntry> & Pick<ProviderLibraryEntry, "owner" | "kind" | "catalogId">): Promise<void> {
  const next = queue.then(async () => {
    const rows = mergeProviderLibrary(await readProviderLibrary(), patch);
    if (!await storage.setItem(PROVIDER_LIBRARY_STORAGE_KEY, rows)) throw new Error("Could not save provider library.");
    listeners.forEach(listener => listener(rows));
  });
  queue = next.catch(() => undefined); return next;
}
export function useProviderLibrary() {
  const [rows, setRows] = useState<ProviderLibraryEntry[]>([]);
  useEffect(() => {
    let alive = true, updated = false;
    const publish = (next: ProviderLibraryEntry[]) => { updated = true; if (alive) setRows(next); };
    listeners.add(publish);
    void readProviderLibrary().then(next => { if (alive && !updated) setRows(next); }).catch(() => undefined);
    return () => { alive = false; listeners.delete(publish); };
  }, []);
  return rows;
}
