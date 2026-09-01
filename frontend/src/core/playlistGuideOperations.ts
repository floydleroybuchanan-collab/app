import { NativeModules } from "react-native";
import type { Channel, SourceStatus } from "@/src/api";
import { refreshEpgOnly, sourceStatus } from "@/src/source";
import { reloadPlaylistCatalog } from "@/src/source.native";
import { listPlaylists, readCombinedPlaylists, refreshPlaylists } from "./playlistRegistry";
import { playlistOwner, PRIMARY_PLAYLIST } from "./playlistCatalog";
import { syncPlaylistEpg } from "./playlistEpg";

export type PlaylistGuideHealth = {
  playlistId: string; name: string; channels: number; matched: number; unmatched: number;
  primaryMatched: number; customMatched: number; sourceIds: string[];
};

async function publish(channels: Channel[]): Promise<void> {
  await reloadPlaylistCatalog();
  // reload reads the same committed catalogs; keep this parameter to make
  // operation ordering explicit and testable without exposing source internals.
  void channels;
}

export async function refreshOnePlaylistOnly(playlistId: string): Promise<void> {
  const channels = await refreshPlaylists(playlistId);
  await publish(channels);
}

export async function refreshEveryPlaylistOnly(): Promise<void> {
  const channels = await refreshPlaylists();
  await publish(channels);
}

export async function refreshOnePlaylistGuide(playlistId: string): Promise<void> {
  const channels = await readCombinedPlaylists();
  if (playlistId === PRIMARY_PLAYLIST) await refreshEpgOnly();
  await syncPlaylistEpg(channels, true, playlistId);
  await publish(channels);
}

export async function refreshOnePlaylistAndGuide(playlistId: string): Promise<void> {
  const channels = await refreshPlaylists(playlistId);
  await publish(channels);
  if (playlistId === PRIMARY_PLAYLIST) await refreshEpgOnly();
  await syncPlaylistEpg(channels, true, playlistId);
  await publish(channels);
}

export async function refreshEveryGuide(): Promise<SourceStatus> {
  await refreshEpgOnly();
  const channels = await readCombinedPlaylists();
  await syncPlaylistEpg(channels, true);
  await publish(channels);
  return sourceStatus();
}

export async function refreshEveryPlaylistAndGuide(): Promise<SourceStatus> {
  await refreshEveryPlaylistOnly();
  return refreshEveryGuide();
}

export async function readPlaylistGuideHealth(channels: Channel[]): Promise<PlaylistGuideHealth[]> {
  const playlists = await listPlaylists();
  const groups = playlists.filter((row) => row.enabled).map((row) => ({
    playlistId: row.id,
    name: row.name,
    channelIds: channels.filter((channel) => playlistOwner(channel) === row.id).map((channel) => channel.id),
  }));
  const module = NativeModules.CharmCustomEpg;
  if (typeof module?.getPlaylistGuideHealth !== "function") return groups.map((row) => ({ ...row, channels: row.channelIds.length, matched: 0, unmatched: row.channelIds.length, primaryMatched: 0, customMatched: 0, sourceIds: [] }));
  const rows = await module.getPlaylistGuideHealth(groups);
  return Array.isArray(rows) ? rows : [];
}
