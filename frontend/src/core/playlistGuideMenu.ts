import type { Channel } from "../api";
import { playlistOwner, type PlaylistRecord } from "./playlistCatalog.ts";

const PROVIDER_GROUP_PREFIX = "@playlist-group:";
export function providerGroupKey(raw: string): string { return PROVIDER_GROUP_PREFIX + encodeURIComponent(raw); }
export function providerGroupIdentity(group: string): string {
  if (!group.startsWith(PROVIDER_GROUP_PREFIX)) return group;
  try { return decodeURIComponent(group.slice(PROVIDER_GROUP_PREFIX.length)); } catch { return group; }
}
export function isProviderGroupKey(group: string): boolean { return group.startsWith(PROVIDER_GROUP_PREFIX); }

export type PlaylistMenuGroup = { key: string; label: string; count: number };
export type PlaylistMenuSection = { id: string; label: string; count: number; groups: PlaylistMenuGroup[] };

/** Build once over the catalog. Favorites remain references, not duplicate channels. */
export function buildPlaylistMenu(
  sources: PlaylistRecord[], channels: Channel[], favorites: ReadonlySet<string>,
  hiddenChannels: ReadonlySet<string>, hiddenGroups: ReadonlySet<string> = new Set(),
): PlaylistMenuSection[] {
  const bySource = new Map<string, { count: number; favorites: number; groups: Map<string, PlaylistMenuGroup> }>();
  for (const source of sources) if (source.enabled) bySource.set(source.id, { count: 0, favorites: 0, groups: new Map() });
  for (const channel of channels) {
    if (hiddenChannels.has(channel.id)) continue;
    const bucket = bySource.get(playlistOwner(channel));
    if (!bucket) continue;
    bucket.count++;
    if (favorites.has(channel.id)) bucket.favorites++;
    const raw = channel.group || "";
    if (hiddenGroups.has(raw)) continue;
    const key = providerGroupKey(raw);
    const existing = bucket.groups.get(key);
    if (existing) existing.count++;
    else bucket.groups.set(key, { key, label: channel.source_group || raw || "Ungrouped", count: 1 });
  }
  const sections: PlaylistMenuSection[] = sources.filter((source) => source.enabled).map((source) => {
    const bucket = bySource.get(source.id)!;
    return { id: source.id, label: source.name, count: bucket.count, groups: [
      { key: "All", label: "All Channels", count: bucket.count },
      { key: "Favorites", label: "Favorites", count: bucket.favorites },
      ...Array.from(bucket.groups.values()),
    ] };
  });
  const count = sections.reduce((total, section) => total + section.count, 0);
  const favoriteCount = Array.from(bySource.values()).reduce((total, bucket) => total + bucket.favorites, 0);
  sections.push({ id: "all", label: "All Playlists", count, groups: [
    { key: "All", label: "All Channels", count }, { key: "Favorites", label: "Favorites", count: favoriteCount },
  ] });
  return sections;
}
