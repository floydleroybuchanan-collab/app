export const MANAGED_CONTENT_SOURCE_IDS = ["primary", "secondary", "tertiary", "quaternary"] as const;
export type ManagedContentSourceId = typeof MANAGED_CONTENT_SOURCE_IDS[number];

export type ManagedContentSource = {
  id: ManagedContentSourceId;
  playlist_url: string;
  epg_url: string;
};

/**
 * `sources` is the scalable RC.6 contract. Named fields remain optional so an
 * APK can restore against the two-source Worker deployed before this contract.
 */
export type ManagedContentAccess = {
  expires_at: number;
  sources?: ManagedContentSource[];
  primary?: Omit<ManagedContentSource, "id">;
  secondary?: Omit<ManagedContentSource, "id">;
  tertiary?: Omit<ManagedContentSource, "id">;
  quaternary?: Omit<ManagedContentSource, "id">;
};

type NormalizedManagedContentAccess = {
  expires_at: number;
  sources: ManagedContentSource[];
};

const EMPTY_ACCESS: NormalizedManagedContentAccess = { expires_at: 0, sources: [] };
let current: NormalizedManagedContentAccess = EMPTY_ACCESS;

function safeUrl(value: unknown): string {
  const url = String(value || "").trim();
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && url.length <= 4096 ? url : "";
  } catch { return ""; }
}

function normalizeSource(id: ManagedContentSourceId, raw: Partial<ManagedContentSource> | null | undefined): ManagedContentSource | null | false {
  const rawPlaylist = String(raw?.playlist_url || "").trim();
  const rawEpg = String(raw?.epg_url || "").trim();
  if (!rawPlaylist && !rawEpg) return null;
  const playlistUrl = safeUrl(rawPlaylist);
  const epgUrl = safeUrl(rawEpg);
  if (!playlistUrl || !epgUrl) return false;
  return { id, playlist_url: playlistUrl, epg_url: epgUrl };
}

function normalizeAccess(value: ManagedContentAccess): NormalizedManagedContentAccess | null {
  if (!value || (!Array.isArray(value.sources) && !MANAGED_CONTENT_SOURCE_IDS.some((id) => value[id]))) return null;
  const byId = new Map<ManagedContentSourceId, ManagedContentSource>();
  const supplied = Array.isArray(value?.sources)
    ? value.sources
    : MANAGED_CONTENT_SOURCE_IDS.map((id) => ({ id, ...(value?.[id] || { playlist_url: "", epg_url: "" }) }));

  for (const raw of supplied) {
    const id = String(raw?.id || "") as ManagedContentSourceId;
    if (!MANAGED_CONTENT_SOURCE_IDS.includes(id) || byId.has(id)) return null;
    const normalized = normalizeSource(id, raw);
    if (normalized === false) return null;
    if (normalized) byId.set(id, normalized);
  }

  // Supplied sources are optional; an explicitly empty collection is valid
  // for a personal-source-only setup. Malformed pairs still fail atomically.
  return {
    expires_at: Math.max(0, Number(value.expires_at) || 0),
    sources: MANAGED_CONTENT_SOURCE_IDS.flatMap((id) => {
      const source = byId.get(id);
      return source ? [source] : [];
    }),
  };
}

export function configureManagedContentAccess(value: ManagedContentAccess): boolean {
  const normalized = normalizeAccess(value);
  // Apply every configured pair at once. Invalid/partial responses leave the
  // last complete catalog untouched rather than stranding one playlist.
  if (!normalized) return false;
  current = normalized;
  return true;
}

export function clearManagedContentAccess(): void {
  current = EMPTY_ACCESS;
}

export function managedContentSources(): readonly ManagedContentSource[] {
  return current.sources;
}

export function managedPlaylistUrl(id: ManagedContentSourceId): string {
  return current.sources.find((source) => source.id === id)?.playlist_url || "";
}

export function managedEpgUrl(id: ManagedContentSourceId): string {
  return current.sources.find((source) => source.id === id)?.epg_url || "";
}

export function managedContentExpiresAt(): number {
  return current.expires_at;
}
