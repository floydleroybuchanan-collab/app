import { Alert, NativeModules, Platform } from "react-native";
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
const MAX_PLAYLIST_BACKUP_BYTES = 12 * 1024 * 1024;
const SAFE_SETTINGS = new Set(["gs_favorites", "gs_pointer_mode", "gs_guide_layout", "gs_guide_density", "gs_safe_preview_mode", "gs_channel_numbers", "gs_channel_logos", "gs_device_layout_mode", "gs_player_timeout_ms", "gs_power_profile", "gs_logos_off_while_surfing", "gs_epg_guide_filter", "gs_guide_window_hours", "gs_clock_24h", "gs_start_screen", "gs_instant_guide"]);

type FullBackupPayload = {
  format: typeof FORMAT;
  version: typeof VERSION;
  createdAt: string;
  scope?: "settings" | "live-tv";
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
      const info = await FileSystem.getInfoAsync(`${PLAYLIST_ROOT}${name}`);
      if (info.exists && info.size && info.size > MAX_PLAYLIST_BACKUP_BYTES) throw new Error("Saved playlists are too large for a safe TV backup. Export settings only.");
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
  if (value.scope != null && value.scope !== "settings" && value.scope !== "live-tv") throw new Error("Unsupported backup coverage.");
  if (Object.entries(value.settings).some(([key,raw]) => !allowedKey(key) || typeof raw !== "string")) throw new Error("Invalid backup settings.");
  if (Object.entries(value.personalPlaylistUrls).some(([id,url]) => !/^user-[a-z0-9-]+$/.test(id) || typeof url !== "string")) throw new Error("Invalid personal playlist backup.");
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
  if (value.scope === "settings") {
    const entries = Object.entries(value.settings);
    if (entries.some(([key, raw]) => !SAFE_SETTINGS.has(key) || typeof raw !== "string")) throw new Error("Invalid settings backup.");
    const previous = await AsyncStorage.multiGet(entries.map(([key]) => key));
    try { await AsyncStorage.multiSet(entries); }
    catch (error) { await AsyncStorage.multiSet(previous.filter((entry): entry is [string,string] => entry[1] != null)); await AsyncStorage.multiRemove(previous.filter(([,v]) => v == null).map(([k])=>k)); throw error; }
    return;
  }
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
export async function writeFullBackup(password: string, settingsOnly = false) {
  if (!ROOT) throw new Error("App storage is unavailable.");
  if (!settingsOnly && (password.length < 10 || password.length > 256)) throw new Error("Use a backup password of 10 to 256 characters.");
  const body: Omit<FullBackupPayload,"checksum"> = settingsOnly ? {
    format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), scope:"settings",
    settings: Object.fromEntries((await AsyncStorage.multiGet([...SAFE_SETTINGS])).filter((entry): entry is [string,string] => entry[1] != null)),
    personalPlaylistUrls:{}, playlistFiles:{}, customization: {hiddenIds:[],customNumbers:{},customOrder:[],groups:[]} as NativeCustomizationSnapshot, manualEpgBindings:{}
  } : {...await capture(),scope:"live-tv"};
  let raw = JSON.stringify({ ...body, checksum: checksum(withoutChecksum(body)) });
  if (raw.length > 16 * 1024 * 1024) throw new Error("Backup exceeds the safety limit. Export settings only or remove unused playlists.");
  if (!settingsOnly) {
    if (!NativeModules.CharmBackupCrypto) throw new Error("Install the updated Android app to create encrypted backups.");
    raw = await NativeModules.CharmBackupCrypto.encrypt(raw,password);
  }
  const fileName = `${PREFIX}${timestamp()}-${settingsOnly ? "settings" : "encrypted"}.json`;
  const portable = await writePortable(raw, fileName);
  return { fileName, portable };
}
export async function restoreFullBackup(password: string) {
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
  const info = await FileSystem.getInfoAsync(selected.uri);
  if (info.exists && info.size && info.size > 23 * 1024 * 1024) throw new Error("Backup exceeds the safety limit.");
  let raw = await FileSystem.readAsStringAsync(selected.uri);
  if (raw.length > 23 * 1024 * 1024) throw new Error("Backup exceeds the safety limit.");
  if (raw.startsWith("CMLBACKUP1.")) {
    if (!NativeModules.CharmBackupCrypto) throw new Error("Install the updated app to restore this encrypted backup.");
    raw = await NativeModules.CharmBackupCrypto.decrypt(raw,password);
  }
  const parsed = parse(raw);
  const accepted = await new Promise<boolean>(resolve => Alert.alert("Restore backup?",
    `${selected.name}\nCreated: ${parsed.createdAt}\n${parsed.scope === "settings" ? "Replaces the included basic Live TV settings and favorites. Playlists and provider credentials stay unchanged." : "Replaces saved Live TV settings, playlists, provider addresses, channel customizations and guide assignments."}\nVOD data and account logins are not restored. Restart the app afterwards.`,
    [{text:"Cancel",style:"cancel",onPress:()=>resolve(false)},{text:"Restore",onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}));
  if (!accepted) throw new Error("Restore cancelled. No settings changed.");
  await apply(parsed);
  return selected.name;
}
