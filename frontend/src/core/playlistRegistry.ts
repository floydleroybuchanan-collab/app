import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import type { Channel } from "@/src/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchNativePlaylist } from "@/src/nativeEpg";
import { combinePlaylistCatalogs, MAX_PERSONAL_PLAYLISTS, PRIMARY_PLAYLIST, SECOND_PLAYLIST,
  scopePlaylistChannels, validatePlaylistImport, type PlaylistRecord } from "./playlistCatalog";

const KEY = "charm_playlist_registry_v1";
const ROOT = `${FileSystem.documentDirectory}playlists/`;
const managedUrls: Record<string, string> = {
  [PRIMARY_PLAYLIST]: (process.env.EXPO_PUBLIC_M3U_URL || "").trim(),
  [SECOND_PLAYLIST]: (process.env.EXPO_PUBLIC_M3U_URL_2 || "").trim(),
};
let records: PlaylistRecord[] | null = null;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const job = queue.then(action); queue = job.catch(() => undefined); return job;
}
function notify() { listeners.forEach((listener) => listener()); }
function makeRecord(id: string, name: string, managed: boolean): PlaylistRecord {
  return { id, name, groupLabel: name, managed, enabled: true, revision: "", count: 0, refreshedAt: 0,
    refreshHours: 24, status: "Not downloaded", epgSourceIds: id === PRIMARY_PLAYLIST ? ["primary"] : id === SECOND_PLAYLIST ? ["owner-secondary"] : [] };
}
async function load(): Promise<PlaylistRecord[]> {
  if (records) return records;
  await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
  const raw = await AsyncStorage.getItem(KEY);
  const saved: PlaylistRecord[] = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(saved)) throw new Error("Playlist settings could not be read. Saved catalogs were not changed.");
  const next = (saved || []).filter((item) => /^[a-z0-9-]+$/.test(item.id));
  if (!next.some((item) => item.id === PRIMARY_PLAYLIST)) next.unshift(makeRecord(PRIMARY_PLAYLIST, "CharmIPTV", true));
  if (managedUrls[SECOND_PLAYLIST] && !next.some((item) => item.id === SECOND_PLAYLIST)) next.splice(1, 0, makeRecord(SECOND_PLAYLIST, "CharmIPTV 2", true));
  records = next;
  return next;
}
async function commit(next: PlaylistRecord[]) {
  // Persist the revision pointer only after its complete catalog has been written.
  // A crash before this write leaves the previous revision authoritative.
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  records = next; notify();
  // Keep the current and previous immutable revision only; interrupted staging files are disposable.
  const keep = new Set(next.flatMap((row) => [row.revision, row.previousRevision].filter(Boolean).map((revision) => `${row.id}-${revision}.json`)));
  try {
    for (const name of await FileSystem.readDirectoryAsync(ROOT)) if (!keep.has(name)) await FileSystem.deleteAsync(`${ROOT}${name}`, { idempotent: true });
  } catch { /* Cleanup failure must not roll back a committed catalog. */ }
}
function pathFor(record: PlaylistRecord) { return `${ROOT}${record.id}-${record.revision}.json`; }
async function readCatalog(record: PlaylistRecord): Promise<Channel[]> {
  if (!record.revision) return [];
  for (const revision of [record.revision, record.previousRevision].filter(Boolean)) {
    try {
      const raw: Channel[] = JSON.parse(await FileSystem.readAsStringAsync(pathFor({ ...record, revision: revision! })));
      if (Array.isArray(raw) && raw.length) return scopePlaylistChannels(record, raw);
    } catch { /* Try the previous complete revision; another source remains usable. */ }
  }
  return [];

}
async function allCatalogs(rows: PlaylistRecord[]) {
  const catalogs = new Map<string, Channel[]>();
  for (const row of rows) catalogs.set(row.id, row.enabled ? await readCatalog(row) : []);
  return catalogs;
}
async function writeCatalog(row: PlaylistRecord, channels: Channel[]): Promise<PlaylistRecord> {
  const next = { ...row, previousRevision: row.revision, revision: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    count: channels.length, refreshedAt: Date.now(), status: `${channels.length.toLocaleString()} channels ready` };
  await FileSystem.writeAsStringAsync(pathFor(next), JSON.stringify(channels));
  const check = await FileSystem.getInfoAsync(pathFor(next));
  if (!check.exists || !check.size) throw new Error("Could not save playlist. Previous catalog kept.");
  return next;
}
export async function getPlaylistUrl(row: PlaylistRecord): Promise<string> {
  return row.managed ? managedUrls[row.id] || "" : await SecureStore.getItemAsync(`playlist-${row.id}`) || "";
}
export function validatePlaylistUrl(url: string) {
  if (/^content:\/\/\S+$/.test(url)) return;
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2048) throw new Error("Enter a complete http:// or https:// M3U URL (up to 2,048 characters).");
  try { new URL(url); } catch { throw new Error("The playlist URL is invalid."); }
}
export async function previewPlaylist(url: string) {
  validatePlaylistUrl(url.trim());
  try { const parsed = await fetchNativePlaylist(url.trim()); validatePlaylistImport(parsed); return parsed.channels; }
  catch (error) {
    // Never surface provider URLs/credentials from fetch/transport exceptions.
    const message = error instanceof Error ? error.message : "";
    if (/^(No playable|Playlist contains|Playlist exceeds)/.test(message)) throw error;
    throw new Error("Could not load a complete M3U playlist. Check the address, credentials and connection; existing channels are unchanged.");
  }
}
export function listPlaylists(): Promise<PlaylistRecord[]> { return exclusive(async () => [...await load()]); }
export async function fetchPlaybackPlaylist(owner: string): Promise<Channel[]> {
  // Recovery deliberately bypasses the import queue and never publishes catalogs.
  const row = (await load()).find((item) => item.id === owner && item.enabled);
  if (!row) return [];
  const url = await getPlaylistUrl(row);
  const channels = await previewPlaylist(url);
  const current = records?.find((item) => item.id === owner && item.enabled);
  if (!current || await getPlaylistUrl(current) !== url) return [];
  return scopePlaylistChannels(current, channels);
}
export function usePlaylists() {
  const [value, setValue] = useState<PlaylistRecord[]>(records || []);
  useEffect(() => { let alive = true; const update = () => { if (alive) setValue([...(records || [])]); };
    listeners.add(update); void listPlaylists().then(update); return () => { alive = false; listeners.delete(update); }; }, []);
  return value;
}

export function seedLegacyPlaylist(channels: Channel[]): Promise<void> {
  return exclusive(async () => {
    const rows = await load(); const primary = rows.find((row) => row.id === PRIMARY_PLAYLIST)!;
    if (primary.revision || !channels.length) return;
    const legacy = channels.filter((channel) => !channel.id.startsWith("pl:"));
    if (!legacy.length) return;
    const next = await writeCatalog(primary, legacy);
    await commit(rows.map((row) => row.id === primary.id ? next : row));
  });
}

export function readCombinedPlaylists(): Promise<Channel[]> {
  return exclusive(async () => { const rows = await load(); return combinePlaylistCatalogs(rows, await allCatalogs(rows)); });
}

export function refreshPlaylists(onlyId?: string, dueOnly = false): Promise<Channel[]> {
  return exclusive(async () => {
    let rows = await load(); const catalogs = await allCatalogs(rows);
    for (const row of [...rows]) {
      if (!row.enabled || (onlyId && row.id !== onlyId)) continue;
      if (dueOnly && row.revision && (!row.refreshHours || Date.now() - row.refreshedAt < row.refreshHours * 3_600_000)) continue;
      const previous = catalogs.get(row.id) || [];
      const previousRows = rows;
      try {
        const fresh = await previewPlaylist(await getPlaylistUrl(row));
        catalogs.set(row.id, scopePlaylistChannels(row, fresh));
        try { combinePlaylistCatalogs(rows, catalogs); } catch (error) { catalogs.set(row.id, previous); throw error; }
        const next = await writeCatalog(row, fresh);
        rows = rows.map((item) => item.id === row.id ? next : item);
        await commit(rows);
      } catch {
        catalogs.set(row.id, previous);
        rows = previousRows.map((item) => item.id === row.id ? { ...item, status: "Refresh failed — previous channels kept. Check source and connection." } : item);
        await commit(rows);
      }
    }
    const combined = combinePlaylistCatalogs(rows, catalogs);
    if (!combined.length) throw new Error("No saved channels available. Open Settings → Playlists to check your sources.");
    return combined;
  });
}

export function savePersonalPlaylist(name: string, url: string, preview: Channel[], existingId?: string): Promise<string> {
  return exclusive(async () => {
    const rows = await load();
    const old = existingId ? rows.find((row) => row.id === existingId) : undefined;
    if (existingId && (!old || old.managed)) throw new Error("This supplied playlist cannot be replaced.");
    if (!old && rows.filter((row) => !row.managed).length >= MAX_PERSONAL_PLAYLISTS) throw new Error("This test build supports five personal playlists.");
    validatePlaylistUrl(url); validatePlaylistImport({ channels: preview, rejected: 0, truncated: false });
    const row = { ...(old || makeRecord(`user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, "", false)), groupLabel: old?.groupLabel || old?.name || name.trim().slice(0, 60) || "My playlist", name: name.trim().slice(0, 60) || "My playlist" };
    const catalogs = await allCatalogs(rows); catalogs.set(row.id, scopePlaylistChannels(row, preview));
    const proposed = old ? rows.map((item) => item.id === row.id ? row : item) : [...rows, row];
    combinePlaylistCatalogs(proposed, catalogs);
    const next = await writeCatalog(row, preview);
    const previousUrl = old ? await getPlaylistUrl(old) : null;
    await SecureStore.setItemAsync(`playlist-${row.id}`, url);
    try { await commit(proposed.map((item) => item.id === row.id ? next : item)); }
    catch (error) { if (previousUrl) await SecureStore.setItemAsync(`playlist-${row.id}`, previousUrl); else await SecureStore.deleteItemAsync(`playlist-${row.id}`); throw error; }
    return row.id;
  });
}
export function updatePlaylist(id: string, change: Partial<Pick<PlaylistRecord, "name" | "enabled" | "refreshHours" | "epgSourceIds">>): Promise<void> {
  return exclusive(async () => {
    const rows = await load(); const next = rows.map((row) => row.id === id ? { ...row, ...change } : row);
    if (!next.some((row) => row.enabled)) throw new Error("Keep at least one playlist enabled.");
    const combined = combinePlaylistCatalogs(next, await allCatalogs(next));
    if (!combined.length && rows.some((row) => row.count > 0)) throw new Error("Download channels for another playlist before disabling this one.");
    await commit(next);
  });
}
export function movePlaylist(id: string, direction: -1 | 1): Promise<void> {
  return exclusive(async () => { const rows = [...await load()]; const at = rows.findIndex((row) => row.id === id); const other = at + direction;
    if (at < 0 || other < 0 || other >= rows.length) return; [rows[at], rows[other]] = [rows[other], rows[at]]; await commit(rows); });
}
export function removePlaylist(id: string): Promise<void> {
  return exclusive(async () => { const rows = await load(); const row = rows.find((item) => item.id === id);
    if (!row || row.managed) throw new Error("Supplied playlists can be disabled, but cannot be removed.");
    await commit(rows.filter((item) => item.id !== id)); await SecureStore.deleteItemAsync(`playlist-${id}`);
    const files = await FileSystem.readDirectoryAsync(ROOT);
    for (const file of files.filter((name) => name.startsWith(`${id}-`))) await FileSystem.deleteAsync(`${ROOT}${file}`, { idempotent: true });
  });
}
