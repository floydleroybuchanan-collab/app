import { discoverPlaylistEpg } from "./playlistEpgDiscovery";
import { replaceAutomaticEpgOwners } from "./additionalEpgOwnership";
import type { Channel } from "@/src/api";
import { listPlaylists } from "./playlistRegistry";
import { playlistOwner, PRIMARY_PLAYLIST } from "./playlistCatalog";
import { getMultiEpgSources, updateMultiEpgRefreshStatus } from "./multiEpgSources";
import { getEpgSourcePreferences } from "./epgSourcePreferences";
import { managedEpgUrl } from "@/src/auth/managedContentAccess";
import { configureNativeUserGuideSources, refreshAssociatedPlaylistGuide, replaceAutomaticPlaylistBindings } from "@/src/nativeEpg";

/** Associations are independent of feeds. Manual Room bindings always override these derived exact-ID bindings. */
export async function syncPlaylistEpg(channels: Channel[], refresh = false, onlyPlaylistId?: string, onSourceReady?: () => void | Promise<void>): Promise<void> {
  await discoverPlaylistEpg();
  const [playlists, extras, prefs] = await Promise.all([listPlaylists(), getMultiEpgSources(), getEpgSourcePreferences()]);
  const sources = [
    { id: "user", name: prefs.userName, url: prefs.userUrl, enabled: prefs.userEnabled, refreshHours: 12 },
    ...extras,
  ];
  const primaryEnabled = prefs.primaryEnabled && !!managedEpgUrl("primary") && playlists.some((row) => row.id === PRIMARY_PLAYLIST && row.enabled);
  await configureNativeUserGuideSources(primaryEnabled, sources);
  const enabled = new Set(sources.filter((source) => source.enabled && source.url).map((source) => source.id));
  const byPlaylist = new Map(playlists.map((source) => [source.id, source.epgSourceIds.filter((id) => enabled.has(id))]));
  const bindings = channels.flatMap((channel) => {
    const ids = byPlaylist.get(playlistOwner(channel)) || [];
    const xmltvId = channel.raw_tvg_id || (playlistOwner(channel) === PRIMARY_PLAYLIST ? channel.tvg_id : "") || channel.name;
    return ids.length && xmltvId ? [{ channelId: channel.id, channelName: channel.name || "", channelLogo: channel.playlist_logo || channel.logo || "", xmltvId, sourceIds: ids }] : [];
  });
  await replaceAutomaticPlaylistBindings(bindings);
  replaceAutomaticEpgOwners(bindings.map((binding) => binding.channelId));
  if (!refresh) return;
  const ownerByChannel = new Map(channels.map((channel) => [channel.id, playlistOwner(channel)]));
  const refreshBindings = onlyPlaylistId ? bindings.filter((binding) => ownerByChannel.get(binding.channelId) === onlyPlaylistId) : bindings;
  const used = new Set(refreshBindings.flatMap((binding) => binding.sourceIds));
  const downloaded = new Set<string>();
  for (const source of sources) {
    if (!source.enabled || !used.has(source.id)) continue;
    // Each source is shared by every associated playlist, never fetched per playlist.
    if (downloaded.has(source.id)) continue;
    downloaded.add(source.id);
    try {
      // A shared feed must keep programmes for every bound playlist, even
      // when the refresh was initiated from just one playlist's settings.
      const result = await refreshAssociatedPlaylistGuide(source.id, source.url, bindings.filter((binding) => binding.sourceIds.includes(source.id)).map((binding) => binding.xmltvId));
      const extra = extras.find((item) => item.id === source.id);
      if (extra) updateMultiEpgRefreshStatus(extra.id, source.url, { ...(result.programmeSwapSucceeded === false ? {} : { lastRefreshAt: Date.now() }),
        lastStatus: result.programmeSwapSucceeded === false ? "No new programmes; previous guide kept." : `Indexed ${result.count} programmes.` });
      // Publish this source's newly matched directory now. A later slow or
      // failing feed must not hide a completed independent guide from the UI.
      await replaceAutomaticPlaylistBindings(bindings);
      if (result.programmeSwapSucceeded !== false) await onSourceReady?.();
    } catch {
      const extra = extras.find((item) => item.id === source.id);
      if (extra) updateMultiEpgRefreshStatus(extra.id, source.url, { lastStatus: "Refresh failed. Previous guide kept; check source and connection." });
    }
  }
}
