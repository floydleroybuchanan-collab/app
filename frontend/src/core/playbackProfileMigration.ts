export type PlaybackProfileType = "hls" | "dash" | "transport" | "progressive" | "unknown";
export type PlaybackProfileEngine = "media3";

export type ChannelPlaybackProfile = {
  declaredType: PlaybackProfileType;
  confirmedType?: Exclude<PlaybackProfileType, "unknown">;
  lastEngine?: PlaybackProfileEngine;
  updatedAt: number;
};

export function normalizePlaybackProfileType(raw: unknown): PlaybackProfileType {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "ts" || value === "m2ts" || value === "mpegts" || value === "mpeg-ts" || value === "transport") return "transport";
  if (value === "hls" || value === "m3u8") return "hls";
  if (value === "dash" || value === "mpd") return "dash";
  if (value === "progressive" || value === "mp4") return "progressive";
  return "unknown";
}

/** A removed engine's successful decode does not confirm Media3's source type. */
export function normalizeStoredPlaybackProfiles(raw: unknown): Record<string, ChannelPlaybackProfile> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries: [string, ChannelPlaybackProfile][] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key.trim() || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const stored = value as Record<string, unknown>;
    const profile: ChannelPlaybackProfile = {
      declaredType: normalizePlaybackProfileType(stored.declaredType),
      updatedAt: typeof stored.updatedAt === "number" && Number.isFinite(stored.updatedAt) ? stored.updatedAt : 0,
    };
    if (stored.lastEngine === "media3") {
      profile.lastEngine = "media3";
      const confirmed = normalizePlaybackProfileType(stored.confirmedType);
      if (confirmed !== "unknown") profile.confirmedType = confirmed;
    }
    entries.push([key, profile]);
  }
  return Object.fromEntries(entries);
}
