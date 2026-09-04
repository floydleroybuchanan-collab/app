export type ManagedContentSource = {
  playlist_url: string;
  epg_url: string;
};

export type ManagedContentAccess = {
  expires_at: number;
  primary: ManagedContentSource;
  secondary: ManagedContentSource;
};

const buildFallback: ManagedContentAccess = {
  expires_at: 0,
  primary: {
    playlist_url: (process.env.EXPO_PUBLIC_M3U_URL || "").trim(),
    epg_url: (process.env.EXPO_PUBLIC_EPG_URL || "").trim(),
  },
  secondary: {
    playlist_url: (process.env.EXPO_PUBLIC_M3U_URL_2 || "").trim(),
    epg_url: (process.env.EXPO_PUBLIC_EPG_URL_2 || "").trim(),
  },
};

let current = buildFallback;

function safeUrl(value: unknown): string {
  const url = String(value || "").trim();
  return /^https?:\/\/\S+$/i.test(url) && url.length <= 4096 ? url : "";
}

export function configureManagedContentAccess(value: ManagedContentAccess): boolean {
  const primaryPlaylist = safeUrl(value?.primary?.playlist_url);
  const primaryEpg = safeUrl(value?.primary?.epg_url);
  if (!primaryPlaylist || !primaryEpg) return false;
  current = {
    expires_at: Math.max(0, Number(value.expires_at) || 0),
    primary: { playlist_url: primaryPlaylist, epg_url: primaryEpg },
    secondary: {
      playlist_url: safeUrl(value?.secondary?.playlist_url),
      epg_url: safeUrl(value?.secondary?.epg_url),
    },
  };
  return true;
}

export function clearManagedContentAccess(): void {
  current = buildFallback;
}

export function managedPlaylistUrl(id: "primary" | "secondary"): string {
  return current[id].playlist_url;
}

export function managedEpgUrl(id: "primary" | "secondary"): string {
  return current[id].epg_url;
}

export function managedContentExpiresAt(): number {
  return current.expires_at;
}
