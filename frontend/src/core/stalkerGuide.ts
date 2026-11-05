import * as FileSystem from "expo-file-system/legacy";
import { NativeModules } from "react-native";
import type { Channel, Program } from "../api";
import type { PlaylistRecord } from "./playlistCatalog";
import { createStalkerClient, decodeStalker } from "./stalker";
import { getPlaylistUrl, listPlaylists } from "./playlistRegistry";

export const stalkerGuideId = (playlistId: string) => `portal-${playlistId}`;
export const stalkerGuideFile = (playlistId: string) => `${FileSystem.documentDirectory}provider-guides/stalker-${playlistId}.xml`;
export function stalkerGuideSources(rows: PlaylistRecord[]) {
  return rows.filter(row => row.kind === "stalker" && !row.managed && /^user-[a-z0-9-]+$/.test(row.id)).map(row => ({
    id: stalkerGuideId(row.id), name: `${row.name} portal guide`, url: stalkerGuideFile(row.id),
    enabled: row.enabled && row.autoEpg !== false, refreshHours: 0,
  }));
}

export async function removeStalkerGuide(playlistId: string) {
  const module = NativeModules.CharmCustomEpg;
  if (typeof module?.removePortalGuide === "function") await module.removePortalGuide(stalkerGuideId(playlistId));
}
function xml(value: string): string { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!); }
const stamp = (value: string) => new Date(value).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14) + " +0000";
/** MediaLab glue: clone portal epochs become XMLTV UTC for the existing transactional importer. */
export function stalkerGuideXml(channels: Channel[], guide: Record<string, Program[]>): string {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?><tv>'];
  for (const channel of channels) {
    const id = channel.stalker_id; if (!id || !/^\d+$/.test(id)) continue;
    parts.push(`<channel id="${id}"><display-name>${xml(channel.name)}</display-name></channel>`);
    for (const program of guide[id] || []) if (program.stop) parts.push(`<programme channel="${id}" start="${stamp(program.start)}" stop="${stamp(program.stop)}"><title>${xml(program.title)}</title><desc>${xml(program.desc)}</desc></programme>`);
  }
  parts.push("</tv>"); return parts.join("");
}
export async function withStalkerGuideFile<T>(row: PlaylistRecord, channels: Channel[], consume: (file: string) => Promise<T>): Promise<T> {
  const secret = await getPlaylistUrl(row), login = decodeStalker(secret);
  if (!login) throw new Error("Portal setup is unavailable.");
  const guide = await createStalkerClient(login).guide();
  const current = (await listPlaylists()).find((item) => item.id === row.id && item.enabled && item.revision === row.revision && item.autoEpg !== false);
  if (!current || await getPlaylistUrl(current) !== secret) throw new Error("Portal changed during guide download. Previous guide kept.");
  await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}provider-guides/`, { intermediates: true });
  const file = stalkerGuideFile(row.id).replace(/\.xml$/, `.${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.xml`);
  try {
    await FileSystem.writeAsStringAsync(file, stalkerGuideXml(channels, guide));
    return await consume(file);
  } finally {
    await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => undefined);
  }
}
