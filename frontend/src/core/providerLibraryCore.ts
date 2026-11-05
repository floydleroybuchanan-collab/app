export type ProviderLibraryEntry = { owner: string; kind: "movie" | "series"; catalogId: string; title: string; favorite: boolean; mediaId: string; positionMs: number; durationMs: number; updatedAt: number };
export const providerLibraryKey = (row: Pick<ProviderLibraryEntry, "owner" | "kind" | "catalogId">) => `${row.owner}:${row.kind}:${row.catalogId}`;
export function providerPlaybackId(kind: "movie" | "series", id: string, seriesNumber?: number): string {
  const suffix = kind === "series" && seriesNumber != null && Number.isSafeInteger(seriesNumber) && seriesNumber >= 0 ? `:${seriesNumber}` : "";
  return `${kind}:${id}${suffix}`;
}
/** This portable state intentionally has no URL, image URL, login or headers. */
export function normalizeProviderLibrary(value: unknown): ProviderLibraryEntry[] {
  if (!Array.isArray(value)) return [];
  const rows = new Map<string, ProviderLibraryEntry>();
  for (const row of value) {
    if (!row || !/^[a-z0-9-]+$/.test(row.owner) || !["movie", "series"].includes(row.kind) || !/^[A-Za-z0-9_-]{1,64}$/.test(row.catalogId)) continue;
    const clean: ProviderLibraryEntry = { owner: row.owner, kind: row.kind, catalogId: row.catalogId, title: String(row.title || "").slice(0, 250), favorite: row.favorite === true,
      mediaId: /^(?:movie:[A-Za-z0-9_-]{1,64}|series:[A-Za-z0-9_-]{1,64}(?:\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{1,64}\.\d{1,8})?(?::\d+)?)$/.test(row.mediaId) ? row.mediaId : "", positionMs: Math.max(0, Number(row.positionMs) || 0), durationMs: Math.max(0, Number(row.durationMs) || 0), updatedAt: Math.max(0, Number(row.updatedAt) || 0) };
    rows.set(providerLibraryKey(clean), clean);
  }
  return [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500);
}
export function mergeProviderLibrary(rows: ProviderLibraryEntry[], patch: Partial<ProviderLibraryEntry> & Pick<ProviderLibraryEntry, "owner" | "kind" | "catalogId">): ProviderLibraryEntry[] {
  const key = providerLibraryKey(patch), previous = rows.find(row => providerLibraryKey(row) === key);
  return normalizeProviderLibrary([{ ...previous, ...patch }, ...rows.filter(row => providerLibraryKey(row) !== key)]);
}
export function providerResumePosition(entry: ProviderLibraryEntry | undefined, mediaId: string, durationMs: number): number {
  return entry?.mediaId === mediaId && entry.positionMs > 0 && entry.positionMs < durationMs - 1000 ? entry.positionMs : 0;
}
