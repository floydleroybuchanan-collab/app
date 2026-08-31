import { playlistOwner } from "./playlistCatalog.ts";

/** Share recovery only within one source. A failing provider never delays another provider's authentication recovery. */
export function createPlaylistPlaybackRefresher<T extends { id: string }>(fetchSource: (owner: string) => Promise<T[]>) {
  const pending = new Map<string, Promise<T[]>>();
  return async (channelId: string): Promise<T | null> => {
    if (!channelId.trim()) return null;
    const owner = playlistOwner({ id: channelId });
    let request = pending.get(owner);
    if (!request) { request = Promise.resolve().then(() => fetchSource(owner)); pending.set(owner, request); }
    try { return (await request).find((channel) => channel.id === channelId) || null; }
    finally { if (pending.get(owner) === request) pending.delete(owner); }
  };
}
