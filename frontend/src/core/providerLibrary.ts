import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { mergeProviderLibrary, normalizeProviderLibrary, type ProviderLibraryEntry } from "./providerLibraryCore";

/** Legacy app-wide key, read only for a guarded one-time migration. */
export const PROVIDER_LIBRARY_STORAGE_KEY = "gs_provider_library_v1";
const LEGACY_OWNER_KEY = "gs_provider_library_legacy_owner_v1";
let activeAccount: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
let legacyClaim: Promise<void> | null = null;
let accountEpoch = 0;
const listeners = new Set<(rows: ProviderLibraryEntry[]) => void>();

function scopedKey(account: string) {
  return `gs_provider_library_v2:${encodeURIComponent(account)}`;
}

export function setProviderLibraryAccount(account: string | null | undefined) {
  const next = typeof account === "string" && account.length > 0 && account.length <= 128 ? account : null;
  if (next === activeAccount) return;
  activeAccount = next;
  const epoch = ++accountEpoch;
  // Do not leave the previous account's titles visible while the new account
  // is being restored from disk, even for one render.
  listeners.forEach(listener => listener([]));
  if (next) void readForAccount(next).then(rows => {
    if (epoch === accountEpoch && activeAccount === next)
      listeners.forEach(listener => listener(rows));
  }).catch(() => undefined);
}

async function migrateLegacyFor(account: string) {
  // Claim old app-global history for the first authenticated account only.
  // Subsequent accounts must never inherit it, even if the old key remains.
  if (!legacyClaim) {
    legacyClaim = (async () => {
      const owner = await storage.getItem<string | null>(LEGACY_OWNER_KEY, null);
      if (owner) return;
      const existing = await storage.getItem<unknown>(PROVIDER_LIBRARY_STORAGE_KEY, []);
      const rows = normalizeProviderLibrary(existing);
      if (!rows.length) return;
      if (!await storage.setItem(scopedKey(account), rows)) return;
      if (!await storage.setItem(LEGACY_OWNER_KEY, account))
        throw new Error("Could not assign existing VOD history to the current account.");
    })();
  }
  await legacyClaim;
}

async function readForAccount(account: string): Promise<ProviderLibraryEntry[]> {
  await migrateLegacyFor(account);
  const raw = await storage.getItem<unknown>(scopedKey(account), []);
  return normalizeProviderLibrary(raw);
}

export async function readProviderLibrary(): Promise<ProviderLibraryEntry[]> {
  const owner = activeAccount;
  return owner ? readForAccount(owner) : [];
}

export function updateProviderLibrary(patch: Partial<ProviderLibraryEntry> & Pick<ProviderLibraryEntry, "owner" | "kind" | "catalogId">): Promise<void> {
  const owner = activeAccount;
  if (!owner) return Promise.reject(new Error("Sign in to save provider viewing history."));
  const next = queue.then(async () => {
    const rows = mergeProviderLibrary(await readForAccount(owner), patch);
    if (!await storage.setItem(scopedKey(owner), rows)) throw new Error("Could not save provider library.");
    if (activeAccount === owner) listeners.forEach(listener => listener(rows));
  });
  queue = next.catch(() => undefined);
  return next;
}

export function useProviderLibrary() {
  const [rows, setRows] = useState<ProviderLibraryEntry[]>([]);
  useEffect(() => {
    let alive = true, revision = 0;
    const publish = (next: ProviderLibraryEntry[]) => {
      revision++;
      if (alive) setRows(next);
    };
    listeners.add(publish);
    const accountAtMount = activeAccount;
    const received = revision;
    void readProviderLibrary().then(next => {
      if (alive && received === revision && accountAtMount === activeAccount) setRows(next);
    }).catch(() => undefined);
    return () => { alive = false; listeners.delete(publish); };
  }, []);
  return rows;
}
