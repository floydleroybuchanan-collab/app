import { Alert, NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { listPlaylists, validatePlaylistUrl } from "@/src/core/playlistRegistry";
import { decodeStalker } from "@/src/core/stalker";
import { scopePlaylistChannels, type PlaylistRecord } from "@/src/core/playlistCatalog";
import { readNativeCustomization, nativeSetChannelHidden, nativeSetCustomNumber, nativeSetChannelOrder, nativeCreateCustomGroup, nativeDeleteCustomGroup, nativeSetCustomGroupMembership, type NativeCustomizationSnapshot } from "@/src/nativeCustomization";
import { clearNativeEpgBindings, readNativeEpgBindings, setNativeEpgBinding, type NativeEpgBindingMap } from "@/src/nativeEpgBindings";

const FORMAT = "charmiptv-full-backup";
const VERSION = 2;
const PREFIX = "Charming MediaLab-Full-Backup-";
const ROOT = `${FileSystem.documentDirectory || ""}full-backups/`;
const PLAYLIST_ROOT = `${FileSystem.documentDirectory || ""}playlists/`;
const MAX_PLAYLIST_BACKUP_BYTES = 12 * 1024 * 1024;
const MAX_BACKUP_TEXT = 16 * 1024 * 1024;
const catalogName = /^[a-z0-9-]{1,180}\.json$/;
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
  portalGuideBindings?: PortalGuideBinding[];
  checksum: string;
};
type PortalGuideBinding = { sourceId: string; channelId: string; xmltvId: string };

function validatePortalGuideBindings(value: unknown, settings: Record<string, string>, files: Record<string, string>): PortalGuideBinding[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error("Invalid portal guide assignments.");
  if (!value.length) return [];
  const rows: PlaylistRecord[] = JSON.parse(settings.charm_playlist_registry_v1 || "[]");
  if (!Array.isArray(rows)) throw new Error("Invalid portal playlist registry.");
  const portals = new Set(rows.filter(row => row.kind === "stalker" && !row.managed && /^user-[a-z0-9-]{1,35}$/.test(row.id)).map(row => `portal-${row.id}`));
  const channelIds = new Set<string>();
  for (const row of rows) {
    if (!/^[a-z0-9-]+$/.test(row.id)) continue;
    const revision = [row.revision, row.previousRevision].find(rev => rev && /^[a-z0-9-]+$/.test(rev) && Object.hasOwn(files, `${row.id}-${rev}.json`));
    if (!revision) continue;
    const raw = JSON.parse(files[`${row.id}-${revision}.json`]);
    if (!Array.isArray(raw)) throw new Error("Invalid playlist catalog for portal guide assignments.");
    for (const channel of scopePlaylistChannels(row, raw)) channelIds.add(channel.id);
  }
  const seen = new Set<string>();
  return value.map(binding => {
    if (!binding || !portals.has(binding.sourceId) || !channelIds.has(binding.channelId) ||
        typeof binding.xmltvId !== "string" || !/^\d{1,30}$/.test(binding.xmltvId) || seen.has(binding.channelId)) {
      throw new Error("A portal guide assignment refers to a missing source or channel.");
    }
    seen.add(binding.channelId);
    return { sourceId: binding.sourceId, channelId: binding.channelId, xmltvId: binding.xmltvId };
  });
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max = 180): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

async function readPlaylistFiles(): Promise<Record<string, string>> {
  if (!FileSystem.documentDirectory) throw new Error("App storage is unavailable.");
  const root = await FileSystem.getInfoAsync(PLAYLIST_ROOT);
  if (!root.exists) return {};
  if (!root.isDirectory) throw new Error("Saved playlist storage is not a directory.");
  const files: Record<string, string> = {};
  let remaining = MAX_PLAYLIST_BACKUP_BYTES;
  for (const name of await FileSystem.readDirectoryAsync(PLAYLIST_ROOT)) {
    if (!catalogName.test(name)) continue;
    const path = PLAYLIST_ROOT + name;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory) throw new Error("A saved playlist catalog could not be read.");
    if (info.size > remaining) throw new Error("Saved playlists are too large for a safe backup or restore.");
    const raw = await FileSystem.readAsStringAsync(path);
    remaining -= raw.length * 2;
    if (remaining < 0) throw new Error("Saved playlists are too large for a safe backup or restore.");
    files[name] = raw;
  }
  return files;
}

function validateBackupData(value: FullBackupPayload): void {
  if (!isRecord(value.settings) || !isRecord(value.personalPlaylistUrls) || !isRecord(value.playlistFiles) ||
      !isRecord(value.customization) || !isRecord(value.manualEpgBindings) || !boundedText(value.createdAt, 80)) {
    throw new Error("Invalid backup data.");
  }
  if (Object.keys(value.settings).length > 300 || Object.entries(value.settings).some(([key, raw]) => !allowedKey(key) || typeof raw !== "string")) throw new Error("Invalid backup settings.");
  if (Object.entries(value.personalPlaylistUrls).some(([id, url]) => !/^user-[a-z0-9-]{1,100}$/.test(id) || !boundedText(url, 8192))) throw new Error("Invalid personal playlist backup.");
  for (const url of Object.values(value.personalPlaylistUrls)) validatePlaylistUrl(url);
  if (Object.entries(value.manualEpgBindings).some(([id, xmltv]) => !boundedText(id) || !boundedText(xmltv))) throw new Error("Invalid guide assignments.");
  const { hiddenIds, customOrder, customNumbers, groups } = value.customization;
  const channelIds = (ids: unknown) => Array.isArray(ids) && ids.length <= 100_000 && ids.every(id => boundedText(id));
  if (!channelIds(hiddenIds) || !channelIds(customOrder) || !isRecord(customNumbers) ||
      Object.entries(customNumbers).some(([id, number]) => !boundedText(id) || !Number.isSafeInteger(number) || number < 0) ||
      !Array.isArray(groups) || groups.length > 10_000 || groups.some(group => !isRecord(group) ||
        !boundedText(group.id) || !boundedText(group.name, 512) || !Number.isSafeInteger(group.position) || !channelIds(group.channelIds))) {
    throw new Error("Invalid channel customizations.");
  }
  let bytes = 0;
  for (const [name, raw] of Object.entries(value.playlistFiles)) {
    if (!catalogName.test(name) || typeof raw !== "string") throw new Error("Invalid playlist catalog path or data.");
    bytes += raw.length * 2;
    if (bytes > MAX_PLAYLIST_BACKUP_BYTES) throw new Error("Backup playlist catalogs exceed the safety limit.");
  }
  const registry = value.settings.charm_playlist_registry_v1;
  const rows: unknown = registry === undefined ? [] : JSON.parse(registry);
  if (!Array.isArray(rows) || rows.length > 10_000) throw new Error("Invalid playlist registry.");
  const expectedFiles = new Set<string>();
  const activeFiles = new Set<string>();
  const registered = new Set<string>();
  const personal = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string" || !/^[a-z0-9-]{1,105}$/.test(row.id) || registered.has(row.id) ||
        typeof row.managed !== "boolean" || typeof row.enabled !== "boolean" || typeof row.name !== "string" ||
        !Array.isArray(row.epgSourceIds) || row.epgSourceIds.some(id => !boundedText(id))) throw new Error("Invalid playlist registry entry.");
    registered.add(row.id);
    if (!row.managed) personal.add(row.id);
    expectedFiles.add(`${row.id}-tombstones.json`);
    for (const revision of [row.revision, row.previousRevision]) {
      if (revision === "" || revision === undefined) continue;
      if (typeof revision !== "string" || !/^[a-z0-9-]{1,70}$/.test(revision)) throw new Error("Invalid playlist catalog revision.");
      const name = `${row.id}-${revision}.json`;
      expectedFiles.add(name);
      if (revision === row.revision) {
        activeFiles.add(name);
        if (!Object.hasOwn(value.playlistFiles, name)) throw new Error("Backup is missing an active playlist catalog.");
      }
    }
  }
  for (const [name, raw] of Object.entries(value.playlistFiles)) {
    if (!expectedFiles.has(name)) throw new Error("Backup contains an unregistered playlist catalog.");
    const channels: unknown = JSON.parse(raw);
    if (!Array.isArray(channels) || (activeFiles.has(name) && !channels.length) || channels.length > 25_000 || channels.some(channel => !isRecord(channel) ||
      !boundedText(channel.id) || typeof channel.name !== "string" || typeof channel.url !== "string")) throw new Error("Invalid playlist catalog rows.");
  }
  if (Object.keys(value.personalPlaylistUrls).some(id => !personal.has(id))) throw new Error("Backup contains credentials for an unknown personal playlist.");
}
async function capture(): Promise<Omit<FullBackupPayload, "checksum">> {
  const playlists = await listPlaylists();
  const keys = (await AsyncStorage.getAllKeys()).filter(allowedKey).slice(0, 300);
  const settings = Object.fromEntries((await AsyncStorage.multiGet(keys)).flatMap(([key, value]) => value == null ? [] : [[key, value]]));
  const personalPlaylistUrls: Record<string, string> = {};
  for (const playlist of playlists.filter((item) => !item.managed)) {
    const value = await SecureStore.getItemAsync(`playlist-${playlist.id}`);
    if (value) personalPlaylistUrls[playlist.id] = value;
  }
  const playlistFiles = await readPlaylistFiles();
  if ((await AsyncStorage.getItem("charm_playlist_registry_v1") || "") !== (settings.charm_playlist_registry_v1 || "")) {
    throw new Error("Saved playlists changed while the backup was being read. Try again.");
  }
  let portalGuideBindings: PortalGuideBinding[] | undefined;
  if (playlists.some(row => row.kind === "stalker")) {
    const module = NativeModules.CharmCustomEpg;
    if (typeof module?.readPortalBackupBindings !== "function") throw new Error("This app build cannot export portal guide assignments.");
    portalGuideBindings = validatePortalGuideBindings(await module.readPortalBackupBindings(), settings, playlistFiles);
  }
  return { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), settings, personalPlaylistUrls, playlistFiles, customization: await readNativeCustomization(), manualEpgBindings: await readNativeEpgBindings(), ...(portalGuideBindings ? { portalGuideBindings } : {}) };
}
function parse(raw: string): FullBackupPayload {
  if (raw.length > MAX_BACKUP_TEXT) throw new Error("Backup exceeds the safety limit.");
  const value = JSON.parse(raw) as FullBackupPayload;
  if (value?.format !== FORMAT || value.version !== VERSION || typeof value.settings !== "object" || typeof value.personalPlaylistUrls !== "object" || typeof value.playlistFiles !== "object" || !value.customization || typeof value.manualEpgBindings !== "object") throw new Error("This is not a supported Charming MediaLab full backup.");
  if (value.scope != null && value.scope !== "settings" && value.scope !== "live-tv") throw new Error("Unsupported backup coverage.");
  const { checksum: supplied, ...body } = value;
  if (!supplied || checksum(withoutChecksum(body)) !== supplied) throw new Error("Backup integrity check failed. The file may be incomplete or changed.");
  validateBackupData(value);
  if (value.portalGuideBindings !== undefined) validatePortalGuideBindings(value.portalGuideBindings, value.settings, value.playlistFiles);
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
  const currentPlaylists = await listPlaylists();
  const currentAllowedKeys = (await AsyncStorage.getAllKeys()).filter(allowedKey).slice(0, 300);
  const currentSettings = Object.fromEntries((await AsyncStorage.multiGet(currentAllowedKeys)).flatMap(([key, raw]) => raw == null ? [] : [[key, raw]]));
  const currentCustomization = await readNativeCustomization();
  const currentBindings = await readNativeEpgBindings();
  const restorePortalBindings = value.portalGuideBindings !== undefined || currentPlaylists.some(row => row.kind === "stalker");
  const portalModule = NativeModules.CharmCustomEpg;
  if (restorePortalBindings && typeof portalModule?.restorePortalBackupBindings !== "function") throw new Error("This app build cannot restore portal guide assignments.");
  const urlIds = new Set([...currentPlaylists.filter((item) => !item.managed).map((item) => item.id), ...Object.keys(value.personalPlaylistUrls)]);
  const currentUrls: Record<string, string> = {};
  for (const id of urlIds) currentUrls[id] = await SecureStore.getItemAsync(`playlist-${id}`) || "";
  const currentPlaylistFiles = await readPlaylistFiles();
  if ((await AsyncStorage.getItem("charm_playlist_registry_v1") || "") !== (currentSettings.charm_playlist_registry_v1 || "")) {
    throw new Error("Saved playlists changed before restore. Try again.");
  }
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
    // Last operation: Room replaces the entire portal scope atomically.
    if (restorePortalBindings) await portalModule.restorePortalBackupBindings(value.portalGuideBindings || []);
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
  validateBackupData({ ...body, checksum: "" });
  let raw = JSON.stringify({ ...body, checksum: checksum(withoutChecksum(body)) });
  if (raw.length > MAX_BACKUP_TEXT) throw new Error("Backup exceeds the safety limit. Export settings only or remove unused playlists.");
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
  const encrypted = raw.startsWith("CMLBACKUP1.");
  if (encrypted) {
    if (!NativeModules.CharmBackupCrypto) throw new Error("Install the updated app to restore this encrypted backup.");
    raw = await NativeModules.CharmBackupCrypto.decrypt(raw,password);
  }
  const parsed = parse(raw);
  for (const credential of Object.values(parsed.personalPlaylistUrls)) {
    if (decodeStalker(credential) && !encrypted) throw new Error("Portal credentials require an encrypted backup.");
  }
  const accepted = await new Promise<boolean>(resolve => Alert.alert("Restore backup?",
    `${selected.name}\nCreated: ${parsed.createdAt}\n${parsed.scope === "settings" ? "Replaces the included basic Live TV settings and favorites. Playlists and provider credentials stay unchanged." : "Replaces saved Live TV settings, playlists, provider addresses, channel customizations and guide assignments. Playlist VOD favorites and resume points are restored when included in the backup."}\nThe built-in VOD library's local data and app account logins are excluded. Restart the app afterwards.`,
    [{text:"Cancel",style:"cancel",onPress:()=>resolve(false)},{text:"Restore",onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}));
  if (!accepted) throw new Error("Restore cancelled. No settings changed.");
  await apply(parsed);
  return selected.name;
}
