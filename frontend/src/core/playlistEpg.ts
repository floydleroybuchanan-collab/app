import { discoverPlaylistEpg } from "./playlistEpgDiscovery";
import { replaceAutomaticEpgOwners } from "./additionalEpgOwnership";
import type { Channel } from "@/src/api";
import { listPlaylists } from "./playlistRegistry";
import { playlistOwner, PRIMARY_PLAYLIST } from "./playlistCatalog";
import { getMultiEpgSources, saveMultiEpgSource } from "./multiEpgSources";
import { getEpgSourcePreferences } from "./epgSourcePreferences";
import { configureNativeUserGuideSources, refreshAssociatedPlaylistGuide, replaceAutomaticPlaylistBindings } from "@/src/nativeEpg";

/** Associations are independent of feeds. Manual Room bindings always override these derived exact-ID bindings. */
export async function syncPlaylistEpg(channels: Channel[], refresh = false): Promise<void> {
  await discoverPlaylistEpg();
  const [playlists, extras, prefs] = await Promise.all([listPlaylists(), getMultiEpgSources(), getEpgSourcePreferences()]);
  const sources = [
    { id: "user", name: prefs.userName, url: prefs.userUrl, enabled: prefs.userEnabled, refreshHours: 12 },
    ...extras,
  ];
  await configureNativeUserGuideSources(prefs.primaryEnabled, sources);
  const enabled = new Set(sources.filter((source) => source.enabled && source.url).map((source) => source.id));
  const byPlaylist = new Map(playlists.map((source) => [source.id, source.epgSourceIds.filter((id) => enabled.has(id))]));
  const bindings = channels.flatMap((channel) => {
    const ids = byPlaylist.get(playlistOwner(channel)) || [];
    const xmltvId = channel.raw_tvg_id || (playlistOwner(channel) === PRIMARY_PLAYLIST ? channel.tvg_id : "");
    return ids.length && xmltvId ? [{ channelId: channel.id, channelName: channel.name || "", xmltvId, sourceIds: ids }] : [];
  });
  await replaceAutomaticPlaylistBindings(bindings);
  replaceAutomaticEpgOwners(bindings.map((binding) => binding.channelId));
  if (!refresh) return;
  const used = new Set(bindings.flatMap((binding) => binding.sourceIds));
  const downloaded = new Set<string>();
  for (const source of sources) {
    if (!source.enabled || !used.has(source.id)) continue;
    // Each source is shared by every associated playlist, never fetched per playlist.
    if (downloaded.has(source.id)) continue;
    downloaded.add(source.id);
    try {
      const result = await refreshAssociatedPlaylistGuide(source.id, source.url, bindings.filter((binding) => binding.sourceIds.includes(source.id)).map((binding) => binding.xmltvId));
      const extra = extras.find((item) => item.id === source.id);
      if (extra) saveMultiEpgSource({ ...extra, lastRefreshAt: result.programmeSwapSucceeded === false ? extra.lastRefreshAt : Date.now(),
        lastStatus: result.programmeSwapSucceeded === false ? "No new programmes; previous guide kept." : `Indexed ${result.count} programmes.` });
    } catch {
      const extra = extras.find((item) => item.id === source.id);
      if (extra) saveMultiEpgSource({ ...extra, lastStatus: "Refresh failed. Previous guide kept; check source and connection." });
    }
  }
  // Newly read directories can now select the first exact match in priority order.
  await replaceAutomaticPlaylistBindings(bindings);
}
