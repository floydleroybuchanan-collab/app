import type { Channel } from "../api";

export const PRIMARY_PLAYLIST = "charm-primary";
export const SECOND_PLAYLIST = "charm-secondary";
export const MAX_COMBINED_CHANNELS = 25_000;
export const MAX_PERSONAL_PLAYLISTS = 5;

export type PlaylistRecord = {
  id: string;
  name: string;
  managed: boolean;
  groupLabel?: string;
  enabled: boolean;
  revision: string;
  previousRevision?: string;
  count: number;
  refreshedAt: number;
  refreshHours: number;
  status: string;
  epgSourceIds: string[];
  discoveredEpgUrls?: string[];
  autoEpg?: boolean;
  autoEpgSourceIds?: string[];
  epgDiscoveryStatus?: string;
};

export function playlistOwner(channel: Pick<Channel, "id" | "playlist_id">): string {
  if (channel.playlist_id) return channel.playlist_id;
  const match = /^pl:([a-z0-9-]+):/.exec(channel.id);
  return match?.[1] || PRIMARY_PLAYLIST;
}

function fingerprint(value: string): string {
  let first = 0x811c9dc5, second = 0x85ebca6b;
  for (let at = 0; at < value.length; at++) {
    first = Math.imul(first ^ value.charCodeAt(at), 0x01000193);
    second = Math.imul(second ^ value.charCodeAt(at), 0xc2b2ae35);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

export function scopePlaylistChannels(source: PlaylistRecord, rows: Channel[]): Channel[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const localId = row.source_channel_id || row.id;
    const id = source.id === PRIMARY_PLAYLIST ? localId : `pl:${source.id}:${fingerprint(localId)}`;
    if (seen.has(id)) throw new Error("Playlist contains conflicting channel identities; previous channels kept.");
    seen.add(id);
    const originalGroup = row.source_group ?? row.group ?? "Other";
    return { ...row, id, source_channel_id: localId, playlist_id: source.id, playlist_name: source.name,
      source_group: originalGroup,
      // Group identity includes an immutable source ID, even when display names collide.
      group: source.id === PRIMARY_PLAYLIST ? originalGroup : `${originalGroup || "Other"} · ${source.groupLabel || source.name} [${source.id}]`,
      raw_tvg_id: row.raw_tvg_id ?? row.tvg_id,
      tvg_id: source.id === PRIMARY_PLAYLIST ? row.tvg_id : "",
    };
  });
}

export function validatePlaylistImport(result: { channels: Channel[]; rejected: number; truncated: boolean }): void {
  if (!result.channels.length) throw new Error("No playable channels found; previous channels kept.");
  if (result.truncated) throw new Error("Playlist exceeds the import limit; previous channels kept.");
  if (result.rejected > 0) throw new Error("Playlist contains invalid entries; previous channels kept. Correct the playlist before importing.");
}

export function combinePlaylistCatalogs(sources: PlaylistRecord[], catalogs: ReadonlyMap<string, Channel[]>): Channel[] {
  const result: Channel[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source.enabled) continue;
    for (const channel of catalogs.get(source.id) || []) {
      if (seen.has(channel.id)) throw new Error("Channel identity collision; catalog was not replaced.");
      seen.add(channel.id); result.push(channel);
      if (result.length > MAX_COMBINED_CHANNELS) throw new Error("Enabled playlists exceed 25,000 channels. Disable another playlist first.");
    }
  }
  return result;
}
