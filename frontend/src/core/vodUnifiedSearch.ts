import { NativeModules, Platform } from "react-native";
import { decodeXtream, loadXtreamCatalog, type XtreamTitle } from "./xtream";
import { decodeStalker } from "./stalker";
import { listStalkerCatalog } from "./stalkerMedia";
import { getPlaylistUrl } from "./playlistRegistry";
import type { PlaylistRecord } from "./playlistCatalog";

export type VodSearchResult = {
  id: string; title: string; image?: string; section: string;
  provider: string; sourceKind: "streamflix" | "xtream" | "stalker";
};
type SearchSource = { id: string; name: string; kind: "xtream" | "stalker"; row: PlaylistRecord };
export const VOD_SEARCH_SOURCES_PER_BATCH = 2;
export const VOD_SEARCH_RESULTS_PER_SOURCE = 24;
export const VOD_SEARCH_RESULTS_TOTAL = 160;
const MAX_CACHE_ENTRIES = 6;
const CACHE_TTL_MS = 2 * 60_000;
const MAX_TITLE_SCAN = 50_000;
const searchCache = new Map<string, { expires: number; results: VodSearchResult[] }>();

export function clearVodSearchCache() { searchCache.clear(); }

export function vodSearchCandidates(rows: PlaylistRecord[]): SearchSource[] {
  // No network request or credential decoding happens when constructing the
  // source list. Keep the user's configured provider order.
  return rows.filter(row => row.enabled && (row.kind === "xtream" || row.kind === "stalker"))
    .map(row => ({ id: row.id, name: row.name, kind: row.kind as "xtream" | "stalker", row }));
}

export function normalizeVodQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, 80).toLowerCase();
}

function limitedMatches(source: SearchSource, rows: XtreamTitle[], needle: string, count: number): VodSearchResult[] {
  const result: VodSearchResult[] = [];
  for (const item of rows.slice(0, MAX_TITLE_SCAN)) {
    if (!item.name.toLowerCase().includes(needle)) continue;
    result.push({
      id: source.id + ":" + item.kind + ":" + item.id,
      title: item.name.slice(0, 250), image: item.image || undefined,
      section: `provider:${source.id}:${item.kind}:${item.id}`,
      provider: source.name, sourceKind: source.kind,
    });
    if (result.length >= count) break;
  }
  return result;
}

function getCached(key: string): VodSearchResult[] | null {
  const item = searchCache.get(key);
  if (!item) return null;
  searchCache.delete(key);
  if (item.expires <= Date.now()) return null;
  searchCache.set(key, item);
  return item.results;
}
function setCached(key: string, results: VodSearchResult[]) {
  searchCache.delete(key);
  searchCache.set(key, { expires: Date.now() + CACHE_TTL_MS, results });
  while (searchCache.size > MAX_CACHE_ENTRIES) searchCache.delete(searchCache.keys().next().value!);
}

export async function searchOneVodSource(
  accountId: string,
  source: SearchSource,
  query: string,
  signal?: AbortSignal,
): Promise<VodSearchResult[]> {
  const normalized = normalizeVodQuery(query);
  if (normalized.length < 2 || signal?.aborted) return [];
  const key = `${accountId}:${source.id}:${normalized}`;
  const existing = getCached(key);
  if (existing) return existing;

  // Resolved provider credentials live only inside the active request and
  // Expo SecureStore. Never write them to a search result/cache/diagnostic.
  const raw = await getPlaylistUrl(source.row);
  const xtream = source.kind === "xtream" ? decodeXtream(raw) : null;
  const stalker = source.kind === "stalker" ? decodeStalker(raw) : null;
  const result: VodSearchResult[] = [];
  if (!xtream && !stalker) return [];
  for (const kind of ["movie", "series"] as const) {
    if (signal?.aborted) throw new Error("VOD search cancelled.");
    const titles = xtream
      ? await loadXtreamCatalog(xtream, kind, signal)
      : await listStalkerCatalog(stalker!, kind, signal);
    result.push(...limitedMatches(source, titles, normalized, VOD_SEARCH_RESULTS_PER_SOURCE - result.length));
    if (result.length >= VOD_SEARCH_RESULTS_PER_SOURCE) break;
  }
  if (signal?.aborted) return [];
  setCached(key, result);
  return result;
}

export async function searchStreamflixTitles(query: string, signal?: AbortSignal): Promise<VodSearchResult[]> {
  if (Platform.OS !== "android" || !NativeModules.CharmVod?.searchLibrary || signal?.aborted) return [];
  const normalized = normalizeVodQuery(query);
  if (normalized.length < 2) return [];
  // This is a user-initiated search, NOT a Live TV home/background request.
  const raw = await NativeModules.CharmVod.searchLibrary(normalized);
  if (signal?.aborted) return [];
  let rows: unknown;
  try { rows = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 30).flatMap((entry): VodSearchResult[] => {
    if (!entry || typeof entry !== "object") return [];
    const section = typeof entry.section === "string" ? entry.section : "";
    if (!/^(?:movie|show):[^\s]{1,300}$/.test(section)) return [];
    return [{
      id: "streamflix:" + section,
      title: String(entry.title || "").slice(0, 250),
      image: /^https?:\/\//i.test(String(entry.poster || "")) ? String(entry.poster).slice(0, 1200) : undefined,
      section, provider: "Streamflix", sourceKind: "streamflix",
    }];
  });
}
