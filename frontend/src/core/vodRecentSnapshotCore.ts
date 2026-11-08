/** Small, serializable display-only VOD shelf. No media URLs, credentials or playback tokens. */
export type VodSnapshotKind = "continue" | "favorites";
export type VodSnapshotItem = { id: string; title: string; poster?: string; section: string };
export const MAX_VOD_SNAPSHOT_ITEMS = 30;

export function vodSnapshotStorageKey(accountId: string | null | undefined, kind: VodSnapshotKind): string | null {
  const account = typeof accountId === "string" ? accountId.trim() : "";
  return account && account.length <= 128
    ? `charm_vod_shelf_v1:${encodeURIComponent(account)}:${kind}`
    : null;
}

/** Strictly bound the snapshot before writing to AsyncStorage in the main process. */
export function normalizeVodSnapshot(value: unknown): VodSnapshotItem[] {
  if (!Array.isArray(value)) return [];
  const results: VodSnapshotItem[] = [];
  const seen = new Set<string>();
  for (const input of value) {
    if (!input || typeof input !== "object") continue;
    const item = input as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const section = typeof item.section === "string" ? item.section.trim() : "";
    // Native VOD route identifiers can be URLs/path fragments; do not store arbitrary routes.
    if (!id || id.length > 300 || !title || !section ||
      section.length > 500 || (!section.startsWith("movie:") && !section.startsWith("show:")) ||
      seen.has(section)) continue;
    seen.add(section);
    const poster = typeof item.poster === "string" ? item.poster.trim() : "";
    // Image URLs may contain signed/private provider parameters: do not persist those.
    const safePoster = poster.length <= 1600 && /^(?:https?:\/\/|content:\/\/)/i.test(poster) &&
      !/[?&](?:token|api_key|apikey|access_token|auth|authorization|password|secret|signature)=/i.test(poster);
    results.push({ id, title: title.slice(0, 250), section, ...(safePoster ? { poster } : {}) });
    if (results.length >= MAX_VOD_SNAPSHOT_ITEMS) break;
  }
  return results;
}
