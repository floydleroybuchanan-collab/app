import type { Channel, Program } from "../api";

type NativeResult = { channelId: string; program: Program };

/** Native search mixes exact playlist IDs with primary XMLTV IDs. */
export function resolveGuideSearchResults(rows: readonly NativeResult[], channels: readonly Channel[]) {
  const wanted = new Set(rows.map(row => row.channelId).filter(Boolean));
  const exact = new Map<string, Channel>();
  const matchedAliases = new Map<string, Channel | null>();
  const rawAliases = new Map<string, Channel | null>();
  if (!wanted.size) return [];
  const rememberAlias = (map: Map<string, Channel | null>, id: string | undefined, channel: Channel) => {
    if (!id || !wanted.has(id)) return;
    const previous = map.get(id);
    if (previous === undefined) map.set(id, channel);
    else if (previous?.id !== channel.id) map.set(id, null);
  };
  for (const channel of channels) {
    if (wanted.has(channel.id)) exact.set(channel.id, channel);
    rememberAlias(matchedAliases, channel.tvg_id, channel);
    rememberAlias(rawAliases, channel.raw_tvg_id, channel);
  }
  const resolved: { channel: Channel; program: Program }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const channel = exact.get(row.channelId) ?? (matchedAliases.has(row.channelId)
      ? matchedAliases.get(row.channelId) : rawAliases.get(row.channelId));
    if (!channel) continue;
    const key = JSON.stringify([channel.id, row.program.start]);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ channel, program: row.program });
  }
  return resolved;
}
