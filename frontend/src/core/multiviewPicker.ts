import type { Channel } from "@/src/api";

export type PickerFilter = "All" | "Favorites" | "Recent";
export type PickerOption = { id: string | null; name: string; count: number };
export const PICKER_PAGE_SIZE = 40;
export const playlistId = (channel: Channel) => channel.playlist_id || "charm-primary";
export const groupName = (channel: Channel) => channel.source_group || channel.group || "Other";

export function multiviewPickerOptions(channels: Channel[], source: string | null) {
  const playable = [...new Map(channels.filter(channel => !!channel.url).map(channel => [channel.id, channel])).values()];
  const sources = new Map<string, PickerOption>();
  const groups = new Map<string, PickerOption>();
  for (const channel of playable) {
    const id = playlistId(channel);
    const entry = sources.get(id) || { id, name: channel.playlist_name || "Playlist 1", count: 0 };
    entry.count++; sources.set(id, entry);
    if (source === null || source === id) {
      const name = groupName(channel);
      const item = groups.get(name) || { id: name, name, count: 0 };
      item.count++; groups.set(name, item);
    }
  }
  const count = [...groups.values()].reduce((total, item) => total + item.count, 0);
  return {
    playable,
    sources: [{ id: null, name: "All playlists", count: playable.length }, ...sources.values()],
    groups: [{ id: null, name: "All groups", count }, ...[...groups.values()].sort((a, b) => a.name.localeCompare(b.name))],
  };
}

export function filterMultiviewChannels(channels: Channel[], options: {
  source: string | null; group: string | null; query: string; filter: PickerFilter;
  favorites: string[]; recent: { id: string }[];
}) {
  const favorites = new Set(options.favorites);
  const recent = new Map(options.recent.map((item, index) => [item.id, index]));
  const query = options.query.trim().toLocaleLowerCase();
  const result = channels.filter(channel => !!channel.url &&
    (options.source === null || playlistId(channel) === options.source) &&
    (options.group === null || groupName(channel) === options.group) &&
    (options.filter !== "Favorites" || favorites.has(channel.id)) &&
    (options.filter !== "Recent" || recent.has(channel.id)) &&
    (!query || `${channel.name} ${groupName(channel)} ${channel.playlist_name || ""}`.toLocaleLowerCase().includes(query)));
  return options.filter === "Recent" ? result.sort((a, b) => recent.get(a.id)! - recent.get(b.id)!) : result;
}

/** Explicit regions prevent native focus-guide layout from collapsing the list under its footer. */
export function multiviewPickerGeometry(width: number, height: number, fontScale = 1, safe = { top: 0, bottom: 0, left: 0, right: 0 }) {
  const scale = Math.max(1, Math.min(fontScale, 1.3));
  const margin = height < 450 ? 8 : 12;
  const padding = height < 450 ? 8 : 12;
  const panelWidth = Math.max(1, Math.min(1100, width - safe.left - safe.right - 2 * margin));
  const panelHeight = Math.max(1, height - safe.top - safe.bottom - 2 * margin);
  const innerWidth = Math.max(1, panelWidth - 2 * padding - 2);
  const rowHeight = Math.ceil(68 * scale);
  const footerHeight = Math.ceil(68 * scale);
  const headerHeight = Math.max(40, Math.min(Math.ceil(204 * scale), panelHeight - 2 * padding - 2 - footerHeight - 12 - rowHeight));
  const listHeight = Math.max(1, panelHeight - 2 * padding - 2 - headerHeight - footerHeight - 12);
  return { margin, padding, panelWidth, panelHeight, innerWidth, rowHeight, footerHeight, headerHeight, listHeight, columns: innerWidth >= 640 ? 2 : 1, scale };
}

export function pickerFocusOffset(index: number, columns: number, rowHeight: number, viewportHeight: number, count: number) {
  const top = Math.floor(index / columns) * rowHeight;
  const maximum = Math.max(0, Math.ceil(count / columns) * rowHeight - viewportHeight);
  return Math.max(0, Math.min(maximum, top - Math.max(0, (viewportHeight - rowHeight) / 2)));
}
