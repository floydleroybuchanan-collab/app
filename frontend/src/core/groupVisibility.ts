import type { Channel } from "../api";

/** Provider group identities include playlist ownership; display aliases never decide visibility. */
export function providerGroupDisabled(group: string, hidden: ReadonlySet<string>): boolean {
  return hidden.has(group) || hidden.has("@playlist-group:" + encodeURIComponent(group));
}
export function activeGroupChannels(channels: Channel[], hidden: ReadonlySet<string>): Channel[] {
  if (!hidden.size) return channels;
  return channels.filter(channel => !providerGroupDisabled(channel.group || "", hidden));
}
