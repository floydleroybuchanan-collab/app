import type { Channel } from "../api";

export const MAX_MULTIVIEW_PANES = 4;
export type MultiviewPane = { channel: Channel; revision: number } | null;
export function multiviewAdmission(panes: MultiviewPane[], slot: number, channel: Channel, providerMax = 0): string | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_MULTIVIEW_PANES) return "Multiview supports up to four channels.";
  if (panes.some((pane, index) => index !== slot && pane?.channel.id === channel.id)) return "That channel is already open in another pane.";
  const owner = channel.playlist_id;
  const sameProvider = panes.filter((pane, index) => index !== slot && pane && pane.channel.playlist_id === owner).length;
  if (providerMax > 0 && sameProvider + 1 > providerMax) return `This provider allows ${providerMax} simultaneous connection${providerMax === 1 ? "" : "s"}. Close another pane from that provider.`;
  return null;
}
export function nextAudiblePane(panes: MultiviewPane[], old: number): number {
  return panes[old] ? old : panes.findIndex(Boolean);
}
