import type { Channel, Program } from "../api";
import { getPlaylistUrl, listPlaylists } from "./playlistRegistry";
import { playlistOwner } from "./playlistCatalog";
import { canReplayXtream, resolveXtreamCatchup } from "./xtreamCatchup";
import { canReplayStalker, resolveStalkerCatchup } from "./stalkerMedia";
import { decodeStalker, encodeStalker } from "./stalker";
import { providerStreamAddress, type ProviderMedia } from "./providerMediaSession";

export function canReplayProviderProgramme(channel: Channel, program: Program): boolean {
  return canReplayXtream(channel, program) || canReplayStalker(channel, program);
}

export async function resolveProviderCatchup(channel: Channel, program: Program): Promise<ProviderMedia> {
  if (canReplayXtream(channel, program)) return resolveXtreamCatchup(channel, program);
  if (!canReplayStalker(channel, program)) throw new Error("This programme is outside the provider's replay window.");
  const owner = playlistOwner(channel);
  const source = (await listPlaylists()).find(row => row.id === owner && row.enabled && row.kind === "stalker");
  const login = source && decodeStalker(await getPlaylistUrl(source));
  if (!login) throw new Error("This portal is unavailable.");
  const link = await resolveStalkerCatchup(login, channel, program);
  return { id: `replay:${channel.stalker_id}:${Date.parse(program.start)}`, owner, title: `${channel.name} · ${program.title}`,
    image: channel.logo, providerLogin: encodeStalker(login), url: providerStreamAddress(link.uri, link.headers) };
}
