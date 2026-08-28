/**
 * Fetch fresh playback URLs without joining Guide/EPG work or writing its cache.
 * Concurrent refresh requests share one catalog download. Results are not cached:
 * a later authentication outage must be able to obtain a newly rotated token.
 */
export function createPlaybackSourceRefresher<T extends { id: string }>(
  fetchChannels: () => Promise<readonly T[]>,
): (channelId: string) => Promise<T | null> {
  let pending: Promise<readonly T[]> | null = null;
  return async (channelId) => {
    const id = String(channelId || "").trim();
    if (!id) return null;
    if (!pending) pending = Promise.resolve().then(fetchChannels);
    const request = pending;
    try {
      return (await request).find((channel) => channel.id === id) || null;
    } finally {
      if (pending === request) pending = null;
    }
  };
}
