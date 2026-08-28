"""Exact normalization for the audited playback-only source refresh change."""

REFRESH_IMPORT = 'import { createPlaybackSourceRefresher } from "@/src/core/playbackSourceRefresh";\n'
REFRESH_BEFORE = """\
/** Refresh only M3U rows and return the latest URL for one logical channel. */
export async function refreshPlaybackChannel(channelId: string): Promise<Channel | null> {
  const id = String(channelId || "").trim();
  if (!id) return null;
  await refreshPlaylistOnly();
  return MEM?.channels.find((channel) => channel.id === id) || null;
}"""
REFRESH_AFTER = """\
// Authentication recovery must not wait for a full EPG refresh or SQLite/cache
// writes. The existing bounded playlist fetch preserves the provider URL/headers;
// only the selected source is returned, without emitting a Guide refresh/retune.
export const refreshPlaybackChannel = createPlaybackSourceRefresher<Channel>(async () => {
  if (!SOURCE_M3U) throw new Error("Playlist is not configured for this build");
  const parsed = await fetchNativePlaylist(sourceUrl(SOURCE_M3U));
  return parsed.channels;
});"""


def normalize_audited_playback_refresh(source: str) -> str:
    """Leave every unrecognized change visible to the pinned transport gate."""
    return source.replace(REFRESH_IMPORT, "").replace(
        REFRESH_AFTER, REFRESH_BEFORE
    ).replace(
        "// The playlist parser returned a fresh channel array. Reuse those",
        "// The native parser already returned a fresh channel array. Reuse those",
    )
