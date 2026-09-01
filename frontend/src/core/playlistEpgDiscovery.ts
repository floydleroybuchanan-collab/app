import { applyDiscoveredPlaylistEpg, listPlaylists } from "./playlistRegistry";
import { ensureDiscoveredEpgSource } from "./multiEpgSources";
import { getEpgSourcePreferences } from "./epgSourcePreferences";
import { PRIMARY_PLAYLIST, SECOND_PLAYLIST } from "./playlistCatalog";

/** Only successfully committed playlist headers enter discovery. No validation-preview side effects. */
export async function discoverPlaylistEpg(): Promise<void> {
  const playlists = await listPlaylists();
  const prefs = await getEpgSourcePreferences();
  for (const row of playlists) {
    if (!row.enabled || row.autoEpg === false || !row.discoveredEpgUrls?.length) continue;
    if (row.autoEpg == null && !row.managed && row.epgSourceIds.length) continue; // Preserve pre-existing manual associations.
    const configuredOwner = row.id === PRIMARY_PLAYLIST ? process.env.EXPO_PUBLIC_EPG_URL : row.id === SECOND_PLAYLIST ? process.env.EXPO_PUBLIC_EPG_URL_2 : "";
    const suppliedId = row.id === PRIMARY_PLAYLIST ? "primary" : row.id === SECOND_PLAYLIST ? "owner-secondary" : "";
    const ids: string[] = configuredOwner?.trim() && suppliedId ? [suppliedId] : [];
    let full = false;
    for (const url of row.discoveredEpgUrls) {
      const id = configuredOwner?.trim() === url.trim() && suppliedId ? suppliedId : prefs.userUrl === url ? "user" : await ensureDiscoveredEpgSource(url, row.name);
      if (!id) { full = true; continue; }
      if (!ids.includes(id)) ids.push(id);
    }
    // Reserved owner slots are automatic build associations, never manual
    // selections. Drop stale reserved ids as well when a supplied URL is later
    // removed so they cannot shadow a real user-selected source.
    const reserved = new Set(["primary", "owner-secondary", suppliedId].filter(Boolean));
    const manual = row.epgSourceIds.filter((id) => !(row.autoEpgSourceIds || []).includes(id) && !reserved.has(id));
    // If capacity prevents a replacement, retain the last working association.
    const automatic = full ? Array.from(new Set([...(row.autoEpgSourceIds || []), ...ids])) : ids;
    const selected = Array.from(new Set([...manual, ...automatic]));
    await applyDiscoveredPlaylistEpg(row, selected, automatic, full
      ? "EPG detected; source limit reached. Free a slot in EPG settings, then refresh. Previous associations kept."
      : `${ids.length} EPG feed(s) associated from supplied settings and playlist headers. Disabled feeds stay disabled; manual channel assignments take priority.`);
  }
}
