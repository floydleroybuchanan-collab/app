import type { Channel, Program } from "../api";
import { playlistOwner } from "./playlistCatalog";
import { getPlaylistUrl, listPlaylists } from "./playlistRegistry";
import { decodeXtream, encodeXtream, xtreamCatchupUrl } from "./xtream";
import type { ProviderMedia } from "./providerMediaSession";

export function canReplayXtream(channel: Channel, program: Program, now = Date.now()): boolean {
  const start = Date.parse(program.start), end = Date.parse(program.stop || "");
  return !!channel.xtream_stream_id && (channel.archive_days || 0) > 0 && Number.isFinite(start) && Number.isFinite(end) && end > start && start < now && start >= now - (channel.archive_days || 0) * 86_400_000;
}
export async function resolveXtreamCatchup(channel: Channel, program: Program): Promise<ProviderMedia> {
  if (!canReplayXtream(channel, program)) throw new Error("This programme is outside the provider's replay window.");
  const owner = playlistOwner(channel);
  const row = (await listPlaylists()).find(item => item.id === owner && item.enabled && item.kind === "xtream");
  if (!row) throw new Error("This provider account is not available.");
  const login = decodeXtream(await getPlaylistUrl(row));
  if (!login) throw new Error("This provider account is not available.");
  const start = Date.parse(program.start), end = Math.min(Date.now(), Date.parse(program.stop || ""));
  return { id: `replay:${channel.xtream_stream_id}:${start}`, owner, title: `${channel.name} · ${program.title}`, image: channel.logo, format: login.output,
    providerLogin: encodeXtream(login),
    url: xtreamCatchupUrl(login, channel.xtream_stream_id!, start, end, row.account?.timeZone) };
}
