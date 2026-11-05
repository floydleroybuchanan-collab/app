import { createStalkerClient, decodeStalker } from "./stalker";
import { getPlaylistUrl, listPlaylists, readCombinedPlaylists } from "./playlistRegistry";
import { playlistOwner } from "./playlistCatalog";

/** Resolve from the enabled source's secure login, never from an untrusted URI's credentials. */
export async function resolveStalkerPlaybackUri(rawUri: string, channelKey: string): Promise<{ uri: string; headers: Record<string, string> } | null> {
  if (!rawUri.startsWith("stalker://")) return null;
  const owner = playlistOwner({ id: channelKey });
  const row = (await listPlaylists()).find((item) => item.id === owner && item.enabled && item.kind === "stalker");
  if (!row) throw new Error("This portal is disabled or has been removed.");
  const secret = await getPlaylistUrl(row), login = decodeStalker(secret);
  const channel = (await readCombinedPlaylists()).find((item) => item.id === channelKey && playlistOwner(item) === owner && item.url === rawUri);
  if (!login || !channel?.stalker_cmd || !channel.stalker_id) throw new Error("Portal channel details are unavailable. Refresh this playlist.");
  const result = await createStalkerClient(login).resolve(channel.stalker_cmd);
  const current = (await listPlaylists()).find((item) => item.id === owner && item.enabled && item.revision === row.revision);
  if (!current || await getPlaylistUrl(current) !== secret) throw new Error("The portal changed during playback setup. Select the channel again.");
  return result;
}
