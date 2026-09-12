import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { decodeXtream, previewXtream, type XtreamAccount } from "./xtream";
import { useEffect, useState } from "react";
import type { Channel } from "@/src/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchNativePlaylist, finishNativeUpdateJob, startNativeUpdateJob } from "@/src/nativeEpg";
import { managedContentSources, managedPlaylistUrl } from "@/src/auth/managedContentAccess";
import { combinePlaylistCatalogs, MANAGED_PLAYLISTS, PRIMARY_PLAYLIST,
  managedPlaylistDefinition, scopePlaylistChannels, validatePlaylistImport, type PlaylistRecord } from "./playlistCatalog";

export type PlaylistPreview = Channel[] & { epgUrls?: string[]; account?: XtreamAccount };

const KEY = "charm_playlist_registry_v1";
const ROOT = `${FileSystem.documentDirectory}playlists/`;
function managedUrl(id: string): string {
  const source = managedPlaylistDefinition(id);
  return source ? managedPlaylistUrl(source.sourceId) : "";
}
let records: PlaylistRecord[] | null = null;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const job = queue.then(action); queue = job.catch(() => undefined); return job;
}
function notify() { listeners.forEach((listener) => listener()); }
function makeRecord(id: string, name: string, managed: boolean): PlaylistRecord {
  const supplied = managed ? managedPlaylistDefinition(id) : undefined;
  return { id, name, groupLabel: name, managed, enabled: true, revision: "", count: 0, refreshedAt: 0,
    refreshHours: 24, status: "Not downloaded", epgSourceIds: supplied ? [supplied.epgSourceId] : [] };
}

function reconcileManagedRows(saved: PlaylistRecord[]): PlaylistRecord[] {
  const configured = new Set(managedContentSources().map((source) => source.id));
  // Source availability is not deletion. Keep revision pointers, ordering and
  // user choices during a missing configuration or a session transition.
  const next = saved.map((row) => {
    const supplied = row.managed ? managedPlaylistDefinition(row.id) : undefined;
    if (!supplied) return row;
    const oldDefault = /^(?:Charm\s?IPTV|Charming MediaLab)(?: [1-4])?$/i;
    return { ...row, name: oldDefault.test(row.name) ? supplied.name : row.name,
      groupLabel: oldDefault.test(row.groupLabel || "") ? supplied.name : row.groupLabel };
  });
  for (const supplied of MANAGED_PLAYLISTS) {
    if (!configured.has(supplied.sourceId) || next.some((item) => item.id === supplied.playlistId)) continue;
    const priorManaged = MANAGED_PLAYLISTS.slice(0, MANAGED_PLAYLISTS.indexOf(supplied))
      .map((item) => next.findIndex((row) => row.id === item.playlistId))
      .filter((index) => index >= 0);
    const insertAt = priorManaged.length ? Math.max(...priorManaged) + 1 : 0;
    next.splice(insertAt, 0, makeRecord(supplied.playlistId, supplied.name, true));
  }
  return next;
}

async function load(): Promise<PlaylistRecord[]> {
  await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
  if (records) {
    const next = reconcileManagedRows(records);
    if (JSON.stringify(next) !== JSON.stringify(records)) {
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
      records = next;
      notify();
    }
    return records;
  }
  const raw = await AsyncStorage.getItem(KEY);
  const saved: PlaylistRecord[] = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(saved)) throw new Error("Playlist settings could not be read. Saved catalogs were not changed.");
  const valid = (saved || []).filter((item) => /^[a-z0-9-]+$/.test(item.id));
  const next = reconcileManagedRows(valid);
  if (JSON.stringify(next) !== JSON.stringify(saved)) await AsyncStorage.setItem(KEY, JSON.stringify(next));
  records = next;
  return next;
}
async function commit(next: PlaylistRecord[]) {
  // Persist the revision pointer only after its complete catalog has been written.
  // A crash before this write leaves the previous revision authoritative.
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  records = next; notify();
  // Keep the current and previous immutable revision only; interrupted staging files are disposable.
  const keep = new Set(next.flatMap((row) => [...[row.revision, row.previousRevision].filter(Boolean).map((revision) => `${row.id}-${revision}.json`), `${row.id}-tombstones.json`]));
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
async function writeCatalog(row: PlaylistRecord, channels: PlaylistPreview): Promise<PlaylistRecord> {
  const previous = await readCatalog(row).catch(() => [] as Channel[]);
  const nextScoped = scopePlaylistChannels(row, channels);
  const liveIds = new Set(nextScoped.map((channel) => channel.id));
  const tombstonePath = `${ROOT}${row.id}-tombstones.json`;
  let priorTombstones: (Channel & { deletedAt: number })[] = [];
  try { priorTombstones = JSON.parse(await FileSystem.readAsStringAsync(tombstonePath)); } catch {}
  const byId = new Map(priorTombstones.filter((item) => item?.id && !liveIds.has(item.id)).map((item) => [item.id, item]));
  for (const channel of previous) if (!liveIds.has(channel.id)) byId.set(channel.id, { ...channel, deletedAt: Date.now() });
  const tombstones = Array.from(byId.values()).sort((a, b) => b.deletedAt - a.deletedAt).slice(0, 25_000);
  await FileSystem.writeAsStringAsync(tombstonePath, JSON.stringify(tombstones));
  const next = { ...row, account: channels.account || row.account, discoveredEpgUrls: channels.epgUrls || row.discoveredEpgUrls || [], previousRevision: row.revision, revision: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    count: channels.length, tombstoneCount: tombstones.length, refreshedAt: Date.now(), status: `${channels.length.toLocaleString()} channels ready` };
  await FileSystem.writeAsStringAsync(pathFor(next), JSON.stringify(channels));
  const check = await FileSystem.getInfoAsync(pathFor(next));
  if (!check.exists || !check.size) throw new Error("Could not save playlist. Previous catalog kept.");
  return next;
}
export async function getPlaylistUrl(row: PlaylistRecord): Promise<string> {
  return row.managed ? managedUrl(row.id) : await SecureStore.getItemAsync(`playlist-${row.id}`) || "";
}
export function validatePlaylistUrl(url: string) {
  if (decodeXtream(url)) return;
  if (/^content:\/\/\S+$/.test(url)) return;
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2048) throw new Error("Enter a complete http:// or https:// M3U URL (up to 2,048 characters).");
  try { new URL(url); } catch { throw new Error("The playlist URL is invalid."); }
}
export async function previewPlaylist(url: string) {
  validatePlaylistUrl(url.trim());
  const xtream = decodeXtream(url);
  if (xtream) return previewXtream(xtream);
  try { const parsed = await fetchNativePlaylist(url.trim()); validatePlaylistImport(parsed); return Object.assign(parsed.channels, { epgUrls: parsed.epgUrls || [] }); }
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
    if (!primary || primary.revision || !channels.length) return;
    const legacy = channels.filter((channel) => !channel.id.startsWith("pl:"));
    if (!legacy.length) return;
    const next = await writeCatalog(primary, legacy);
    await commit(rows.map((row) => row.id === primary.id ? next : row));
  });
}

export function readCombinedPlaylists(): Promise<Channel[]> {
  return exclusive(async () => { const rows = await load(); return combinePlaylistCatalogs(rows, await allCatalogs(rows)); });
}

export function refreshPlaylists(onlyId?: string, dueOnly = false, canStartNext: () => boolean = () => true): Promise<Channel[]> {
  return exclusive(async () => {
    let rows = await load(); const catalogs = await allCatalogs(rows);
    for (const row of [...rows]) {
      if (!canStartNext()) break;
      if (!row.enabled || (onlyId && row.id !== onlyId)) continue;
      if (dueOnly && row.revision && (!row.refreshHours || Date.now() - row.refreshedAt < row.refreshHours * 3_600_000)) continue;
      const previous = catalogs.get(row.id) || [];
      const previousRows = rows;
      const jobId = await startNativeUpdateJob(row.id, "playlist", dueOnly ? "schedule" : "manual").catch(() => 0);
      try {
        const fresh = await previewPlaylist(await getPlaylistUrl(row));
        catalogs.set(row.id, scopePlaylistChannels(row, fresh));
        try { combinePlaylistCatalogs(rows, catalogs); } catch (error) { catalogs.set(row.id, previous); throw error; }
        const next = await writeCatalog(row, fresh);
        rows = rows.map((item) => item.id === row.id ? next : item);
        await commit(rows);
        await finishNativeUpdateJob(jobId, "succeeded", fresh.length).catch(() => undefined);
      } catch (error) {
        catalogs.set(row.id, previous);
        const safeReason = error instanceof Error && /^(Enabled playlists exceed|Playlist contains|Playlist exceeds|No playable|Your provider account|The provider rejected|Could not contact the Xtream provider)/.test(error.message)
          ? error.message : "Refresh failed — previous channels kept. Check source and connection.";
        rows = previousRows.map((item) => item.id === row.id ? { ...item, status: safeReason } : item);
        await commit(rows);
        await finishNativeUpdateJob(jobId, "failed", 0, safeReason).catch(() => undefined);
      }
    }
    const combined = combinePlaylistCatalogs(rows, catalogs);
    if (!combined.length && rows.some((row) => row.enabled)) throw new Error("No saved channels available. Open Settings → Playlists to check your sources.");
    return combined;
  });
}

export function savePersonalPlaylist(name: string, url: string, preview: Channel[], existingId?: string): Promise<string> {
  return exclusive(async () => {
    const rows = await load();
    const old = existingId ? rows.find((row) => row.id === existingId) : undefined;
    if (existingId && (!old || old.managed)) throw new Error("This supplied playlist cannot be replaced.");
    validatePlaylistUrl(url); validatePlaylistImport({ channels: preview, rejected: 0, truncated: false });
    const row = { kind: (decodeXtream(url) ? "xtream" : "m3u") as "xtream" | "m3u", ...(old || makeRecord(`user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, "", false)), groupLabel: old?.groupLabel || old?.name || name.trim().slice(0, 60) || "My playlist", name: name.trim().slice(0, 60) || "My playlist" };
    const catalogs = await allCatalogs(rows); catalogs.set(row.id, scopePlaylistChannels(row, preview));
    const proposed = old ? rows.map((item) => item.id === row.id ? row : item) : [...rows, row];
    combinePlaylistCatalogs(proposed, catalogs);
    row.kind = decodeXtream(url) ? "xtream" : "m3u";
    const next = await writeCatalog(row, preview);
    const previousUrl = old ? await getPlaylistUrl(old) : null;
    await SecureStore.setItemAsync(`playlist-${row.id}`, url);
    try { await commit(proposed.map((item) => item.id === row.id ? next : item)); }
    catch (error) { if (previousUrl) await SecureStore.setItemAsync(`playlist-${row.id}`, previousUrl); else await SecureStore.deleteItemAsync(`playlist-${row.id}`); throw error; }
    return row.id;
  });
}
export function updatePlaylist(id: string, change: Partial<Pick<PlaylistRecord, "name" | "enabled" | "refreshHours" | "epgSourceIds" | "autoEpg" | "autoEpgSourceIds" | "epgDiscoveryStatus">>): Promise<void> {
  return exclusive(async () => {
    const rows = await load(); const next = rows.map((row) => row.id === id ? { ...row, ...change } : row);
    combinePlaylistCatalogs(next, await allCatalogs(next));
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
    const next = rows.filter((item) => item.id !== id);
    await commit(next); await SecureStore.deleteItemAsync(`playlist-${id}`);
    const files = await FileSystem.readDirectoryAsync(ROOT);
    for (const file of files.filter((name) => name.startsWith(`${id}-`))) await FileSystem.deleteAsync(`${ROOT}${file}`, { idempotent: true });
  });
}


export function applyDiscoveredPlaylistEpg(expected: PlaylistRecord, ids: string[], automaticIds: string[], status: string): Promise<void> {
  return exclusive(async () => {
    const rows = await load();
    const current = rows.find((row) => row.id === expected.id);
    // A manual edit, removal or newer import wins over a discovery already in flight.
    if (!current || current.autoEpg === false || current.revision !== expected.revision || JSON.stringify(current.epgSourceIds) !== JSON.stringify(expected.epgSourceIds)) return;
    if (JSON.stringify(ids) === JSON.stringify(current.epgSourceIds) && current.epgDiscoveryStatus === status) return;
    await commit(rows.map((row) => row.id === expected.id ? { ...row, epgSourceIds: ids, autoEpgSourceIds: automaticIds, autoEpg: true, epgDiscoveryStatus: status } : row));
  });
}
