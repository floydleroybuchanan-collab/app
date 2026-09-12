import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { listPlaylists } from "@/src/core/playlistRegistry";
import { readNativeCustomization, nativeSetChannelHidden, nativeSetCustomNumber, nativeSetChannelOrder, nativeCreateCustomGroup, nativeDeleteCustomGroup, nativeSetCustomGroupMembership, type NativeCustomizationSnapshot } from "@/src/nativeCustomization";
import { clearNativeEpgBindings, readNativeEpgBindings, setNativeEpgBinding, type NativeEpgBindingMap } from "@/src/nativeEpgBindings";

const FORMAT = "charmiptv-full-backup";
const VERSION = 2;
const PREFIX = "Charming MediaLab-Full-Backup-";
const ROOT = `${FileSystem.documentDirectory || ""}full-backups/`;
const PLAYLIST_ROOT = `${FileSystem.documentDirectory || ""}playlists/`;
const MAX_PLAYLIST_BACKUP_BYTES = 96 * 1024 * 1024;

type FullBackupPayload = {
  format: typeof FORMAT;
  version: typeof VERSION;
  createdAt: string;
  settings: Record<string, string>;
  personalPlaylistUrls: Record<string, string>;
  playlistFiles: Record<string, string>;
  customization: NativeCustomizationSnapshot;
  manualEpgBindings: NativeEpgBindingMap;
  checksum: string;
};

function checksum(value: string): string {
  // Two independent 32-bit accumulators detect truncation/corruption without
  // requiring another native crypto dependency in the TV build.
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = (Math.imul(b ^ code, 0x85ebca6b) + index) >>> 0;
  }
  return `${value.length.toString(16)}-${a.toString(16).padStart(8, "0")}-${b.toString(16).padStart(8, "0")}`;
}
function withoutChecksum(value: Omit<FullBackupPayload, "checksum">) { return JSON.stringify(value); }
function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function allowedKey(key: string) {
  return /^(gs_|charm_playlist_registry_v1$)/.test(key) && !/(cache|diagnostic|last_error|progress)/i.test(key);
}
async function capture(): Promise<Omit<FullBackupPayload, "checksum">> {
  const keys = (await AsyncStorage.getAllKeys()).filter(allowedKey).slice(0, 300);
  const settings = Object.fromEntries((await AsyncStorage.multiGet(keys)).flatMap(([key, value]) => value == null ? [] : [[key, value]]));
  const playlists = await listPlaylists();
  const personalPlaylistUrls: Record<string, string> = {};
  for (const playlist of playlists.filter((item) => !item.managed)) {
    const value = await SecureStore.getItemAsync(`playlist-${playlist.id}`);
    if (value) personalPlaylistUrls[playlist.id] = value;
  }
  const playlistFiles: Record<string, string> = {};
  let playlistBytes = 0;
  try {
    for (const name of await FileSystem.readDirectoryAsync(PLAYLIST_ROOT)) {
      if (!/^[a-z0-9-]+\.json$/.test(name)) continue;
      const raw = await FileSystem.readAsStringAsync(`${PLAYLIST_ROOT}${name}`);
      playlistBytes += raw.length * 2;
      if (playlistBytes > MAX_PLAYLIST_BACKUP_BYTES) throw new Error("Saved playlists are too large for a safe TV backup. Remove an unused playlist or old catalog and try again.");
      playlistFiles[name] = raw;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("too large")) throw error;
  }
  return { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), settings, personalPlaylistUrls, playlistFiles, customization: await readNativeCustomization(), manualEpgBindings: await readNativeEpgBindings() };
}
function parse(raw: string): FullBackupPayload {
  const value = JSON.parse(raw) as FullBackupPayload;
  if (value?.format !== FORMAT || value.version !== VERSION || typeof value.settings !== "object" || typeof value.personalPlaylistUrls !== "object" || typeof value.playlistFiles !== "object" || !value.customization || typeof value.manualEpgBindings !== "object") throw new Error("This is not a supported Charming MediaLab full backup.");
  const { checksum: supplied, ...body } = value;
  if (!supplied || checksum(withoutChecksum(body)) !== supplied) throw new Error("Backup integrity check failed. The file may be incomplete or changed.");
  return value;
}
async function writePortable(raw: string, fileName: string) {
  await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
  await FileSystem.writeAsStringAsync(`${ROOT}${fileName}`, raw);
  if (Platform.OS === "android") {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (permission.granted) {
      const uri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, fileName, "application/json");
      await FileSystem.writeAsStringAsync(uri, raw);
      return true;
    }
  }
  return false;
}
async function applyCustomization(next: NativeCustomizationSnapshot) {
  const current = await readNativeCustomization();
  for (const id of current.hiddenIds) await nativeSetChannelHidden(id, false);
  for (const id of Object.keys(current.customNumbers)) await nativeSetCustomNumber(id, null);
  for (const group of current.groups) await nativeDeleteCustomGroup(group.id);
  for (const id of next.hiddenIds || []) await nativeSetChannelHidden(id, true);
  for (const [id, number] of Object.entries(next.customNumbers || {})) await nativeSetCustomNumber(id, number);
  await nativeSetChannelOrder(next.customOrder || []);
  for (const group of [...(next.groups || [])].sort((a, b) => a.position - b.position)) {
    await nativeCreateCustomGroup(group.id, group.name);
    for (const channelId of group.channelIds || []) await nativeSetCustomGroupMembership(group.id, channelId, true);
  }
}
async function applyBindings(next: NativeEpgBindingMap) {
  await clearNativeEpgBindings();
  for (const [channelId, xmltvId] of Object.entries(next)) await setNativeEpgBinding(channelId, xmltvId);
}
async function apply(value: FullBackupPayload) {
  const currentAllowedKeys = (await AsyncStorage.getAllKeys()).filter(allowedKey).slice(0, 300);
  const currentSettings = Object.fromEntries((await AsyncStorage.multiGet(currentAllowedKeys)).flatMap(([key, raw]) => raw == null ? [] : [[key, raw]]));
  const currentCustomization = await readNativeCustomization();
  const currentBindings = await readNativeEpgBindings();
  const currentPlaylists = await listPlaylists();
  const urlIds = new Set([...currentPlaylists.filter((item) => !item.managed).map((item) => item.id), ...Object.keys(value.personalPlaylistUrls)]);
  const currentUrls: Record<string, string> = {};
  for (const id of urlIds) currentUrls[id] = await SecureStore.getItemAsync(`playlist-${id}`) || "";
  const currentPlaylistFiles: Record<string, string> = {};
  try {
    for (const name of await FileSystem.readDirectoryAsync(PLAYLIST_ROOT)) {
      if (/^[a-z0-9-]+\.json$/.test(name)) currentPlaylistFiles[name] = await FileSystem.readAsStringAsync(`${PLAYLIST_ROOT}${name}`);
    }
  } catch {}
  try {
    await FileSystem.makeDirectoryAsync(PLAYLIST_ROOT, { intermediates: true });
    for (const [name, raw] of Object.entries(value.playlistFiles)) {
      if (!/^[a-z0-9-]+\.json$/.test(name) || typeof raw !== "string") throw new Error("Backup contains an invalid playlist catalog.");
      await FileSystem.writeAsStringAsync(`${PLAYLIST_ROOT}${name}`, raw);
    }
    for (const name of Object.keys(currentPlaylistFiles)) {
      if (!(name in value.playlistFiles)) await FileSystem.deleteAsync(`${PLAYLIST_ROOT}${name}`, { idempotent: true });
    }
    const restoredKeys = new Set(Object.keys(value.settings));
    const obsoleteKeys = currentAllowedKeys.filter((key) => !restoredKeys.has(key));
    if (obsoleteKeys.length) await AsyncStorage.multiRemove(obsoleteKeys);
    await AsyncStorage.multiSet(Object.entries(value.settings));
    for (const id of urlIds) {
      if (!(id in value.personalPlaylistUrls)) await SecureStore.deleteItemAsync(`playlist-${id}`);
    }
    for (const [id, url] of Object.entries(value.personalPlaylistUrls)) await SecureStore.setItemAsync(`playlist-${id}`, url);
    await applyCustomization(value.customization);
    await applyBindings(value.manualEpgBindings);
  } catch (error) {
    try {
      for (const name of await FileSystem.readDirectoryAsync(PLAYLIST_ROOT)) {
        if (/^[a-z0-9-]+\.json$/.test(name) && !(name in currentPlaylistFiles)) await FileSystem.deleteAsync(`${PLAYLIST_ROOT}${name}`, { idempotent: true });
      }
      for (const [name, raw] of Object.entries(currentPlaylistFiles)) await FileSystem.writeAsStringAsync(`${PLAYLIST_ROOT}${name}`, raw);
    } catch {}
    const attemptedKeys = new Set([...currentAllowedKeys, ...Object.keys(value.settings)]);
    const addedKeys = Array.from(attemptedKeys).filter((key) => !(key in currentSettings));
    if (addedKeys.length) await AsyncStorage.multiRemove(addedKeys).catch(() => undefined);
    await AsyncStorage.multiSet(Object.entries(currentSettings)).catch(() => undefined);
    for (const [id, url] of Object.entries(currentUrls)) {
      if (url) await SecureStore.setItemAsync(`playlist-${id}`, url);
      else await SecureStore.deleteItemAsync(`playlist-${id}`);
    }
    await applyCustomization(currentCustomization).catch(() => undefined);
    await applyBindings(currentBindings).catch(() => undefined);
    throw error;
  }
}
export async function writeFullBackup() {
  if (!ROOT) throw new Error("App storage is unavailable.");
  const body = await capture();
  const raw = JSON.stringify({ ...body, checksum: checksum(withoutChecksum(body)) }, null, 2);
  const fileName = `${PREFIX}${timestamp()}.json`;
  const portable = await writePortable(raw, fileName);
  return { fileName, portable };
}
export async function restoreFullBackup() {
  const candidates: { uri: string; name: string }[] = [];
  try { for (const name of await FileSystem.readDirectoryAsync(ROOT)) if ((name.startsWith(PREFIX) || name.startsWith("CharmIPTV-Full-Backup-")) && name.endsWith(".json")) candidates.push({ uri: `${ROOT}${name}`, name }); } catch {}
  if (!candidates.length && Platform.OS === "android") {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) throw new Error("Backup folder selection was cancelled.");
    for (const uri of await FileSystem.StorageAccessFramework.readDirectoryAsync(permission.directoryUri)) {
      let name = uri; try { name = decodeURIComponent(uri).split("/").pop() || uri; } catch {}
      if ((name.includes(PREFIX) || name.includes("CharmIPTV-Full-Backup-")) && name.endsWith(".json")) candidates.push({ uri, name });
    }
  }
  candidates.sort((a, b) => b.name.replace(/^.*Backup-/, "").localeCompare(a.name.replace(/^.*Backup-/, "")));
  if (!candidates.length) throw new Error("No Charming MediaLab full backup was found.");
  const selected = candidates[0];
  await apply(parse(await FileSystem.readAsStringAsync(selected.uri)));
  return selected.name;
}
