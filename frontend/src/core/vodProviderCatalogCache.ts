import type { XtreamTitle } from "./xtream";

const MAX_SOURCES = 2;
const MAX_TITLES_PER_SOURCE = 5_000;
const TTL_MS = 5 * 60_000;
type Entry = { storedAt: number; rows: XtreamTitle[] };
const cache = new Map<string, Entry>();

/** No secrets, URLs with credentials, account tokens or provider login objects. */
export function readVodProviderCatalogCache(key: string): XtreamTitle[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  if (Date.now() - entry.storedAt >= TTL_MS) return null;
  cache.set(key, entry);
  return entry.rows;
}
export function writeVodProviderCatalogCache(key: string, rows: XtreamTitle[]): void {
  if (rows.length > MAX_TITLES_PER_SOURCE) return; // never truncate a real provider catalog
  cache.delete(key);
  cache.set(key, { storedAt: Date.now(), rows });
  while (cache.size > MAX_SOURCES) cache.delete(cache.keys().next().value!);
}
export function clearVodProviderCatalogCache(): void { cache.clear(); }
