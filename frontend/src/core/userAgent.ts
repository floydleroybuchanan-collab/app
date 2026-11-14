/**
 * The User-Agent the app sends when it asks a provider for playlists, guide data
 * and streams. The default is a TiViMate-style Android TV agent because many IPTV
 * panels block unknown strings. Streams that set their own User-Agent keep it.
 */
export const DEFAULT_USER_AGENT = "TiviMate/5.1.6 (Linux; Android TV)";
export const MAX_USER_AGENT_LENGTH = 200;

export type UserAgentPreset = "default" | "vlc" | "kodi" | "chrome" | "custom";
export type UserAgentChoice = { preset: UserAgentPreset; custom: string };

export const USER_AGENT_PRESETS: readonly { id: Exclude<UserAgentPreset, "custom">; label: string; value: string }[] = [
  { id: "default", label: "Default", value: DEFAULT_USER_AGENT },
  { id: "vlc", label: "VLC", value: "VLC/3.0.20 LibVLC/3.0.20" },
  { id: "kodi", label: "Kodi", value: "Kodi/21.0 (Linux; Android 13) App_Bitness/64 Version/21.0" },
  { id: "chrome", label: "Chrome", value: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" },
];

/** While typing: printable ASCII only and capped. Spaces are kept so "My Player" can be typed. */
export function cleanUserAgentInput(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[^\t\x20-\x7e]/g, "").slice(0, MAX_USER_AGENT_LENGTH);
}

/** What is actually sent: the typed text, trimmed, always a legal one-line header value. */
export function sanitizeUserAgent(raw: unknown): string {
  return cleanUserAgentInput(raw).trim();
}

export function normalizeUserAgentChoice(raw: unknown): UserAgentChoice {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<UserAgentChoice>;
  const preset: UserAgentPreset = value.preset === "vlc" || value.preset === "kodi" || value.preset === "chrome" || value.preset === "custom" ? value.preset : "default";
  return { preset, custom: cleanUserAgentInput(value.custom) };
}

/** The User-Agent a choice stands for. An empty custom value falls back to the default. */
export function resolveUserAgent(choice: UserAgentChoice): string {
  if (choice.preset === "custom") return sanitizeUserAgent(choice.custom) || DEFAULT_USER_AGENT;
  return USER_AGENT_PRESETS.find((preset) => preset.id === choice.preset)?.value ?? DEFAULT_USER_AGENT;
}

/** What is saved natively: blank means the default, so the app default can change later. */
export function nativeUserAgentValue(choice: UserAgentChoice): string {
  return choice.preset === "default" ? "" : resolveUserAgent(choice);
}

let active = DEFAULT_USER_AGENT;
export function getActiveUserAgent(): string { return active; }
export function setActiveUserAgent(value: unknown): void { active = sanitizeUserAgent(value) || DEFAULT_USER_AGENT; }
