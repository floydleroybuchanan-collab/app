import { USER_AGENT_PRESETS, cleanUserAgentInput, sanitizeUserAgent } from "./userAgent.ts";

/**
 * Optional User-Agent for one personal playlist. Blank means "no choice here": the playlist then uses
 * whatever the app already sends (the Settings choice, or the app default). Supplied playlists never use this.
 */
export type PlaylistAgentPreset = "app" | "vlc" | "kodi" | "chrome" | "custom";
export type PlaylistAgentChoice = { preset: PlaylistAgentPreset; custom: string };

export const PLAYLIST_AGENT_OPTIONS: readonly { id: PlaylistAgentPreset; label: string; value: string }[] = [
  { id: "app", label: "App default", value: "" },
  ...USER_AGENT_PRESETS.filter((preset) => preset.id !== "default").map((preset) => ({ id: preset.id as PlaylistAgentPreset, label: preset.label, value: preset.value })),
  { id: "custom", label: "Custom", value: "" },
];

/** The value stored for a choice: blank for the app default. */
export function playlistAgentValue(choice: PlaylistAgentChoice): string {
  if (choice.preset === "app") return "";
  if (choice.preset === "custom") return sanitizeUserAgent(choice.custom);
  return PLAYLIST_AGENT_OPTIONS.find((option) => option.id === choice.preset)?.value ?? "";
}

/** The choice a saved value stands for, so the editor can show it again. */
export function playlistAgentChoice(saved?: string): PlaylistAgentChoice {
  const value = sanitizeUserAgent(saved);
  if (!value) return { preset: "app", custom: "" };
  const match = PLAYLIST_AGENT_OPTIONS.find((option) => option.value && option.value === value);
  return match ? { preset: match.id, custom: "" } : { preset: "custom", custom: cleanUserAgentInput(value) };
}

/** What the editor shows under the choices. */
export function describePlaylistAgent(choice: PlaylistAgentChoice, appCurrent: string): string {
  const value = playlistAgentValue(choice);
  return value || `the app default (${appCurrent})`;
}

const byPlaylist = new Map<string, string>();
/** Called whenever the saved playlists change. Only personal playlists with a choice are kept. */
export function setPlaylistAgents(rows: readonly { id: string; managed?: boolean; userAgent?: string }[]): void {
  byPlaylist.clear();
  for (const row of rows) {
    const value = row.managed ? "" : sanitizeUserAgent(row.userAgent);
    if (value) byPlaylist.set(row.id, value);
  }
}

/** Channels of a personal playlist carry its id in their key ("pl:<playlist>:<channel>"). */
export function playlistAgentForChannel(channelKey?: string | null): string | undefined {
  const match = /^pl:([a-z0-9-]+):/.exec(String(channelKey || ""));
  return match ? byPlaylist.get(match[1]) : undefined;
}
