import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type PlaybackProfileType = "hls" | "dash" | "transport" | "progressive" | "unknown";
export type PlaybackProfileEngine = "media3" | "vlc";

export type ChannelPlaybackProfile = {
  declaredType: PlaybackProfileType;
  confirmedType?: Exclude<PlaybackProfileType, "unknown">;
  lastEngine?: PlaybackProfileEngine;
  updatedAt: number;
};

const STORAGE_KEY = "gs_channel_playback_profiles_v1";
const MAX_PROFILES = 512;
let cached: Record<string, ChannelPlaybackProfile> = {};
let loaded = false;
let loadPromise: Promise<void> | null = null;
let persistChain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function normalizeType(raw: unknown): PlaybackProfileType {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "ts" || value === "m2ts" || value === "mpegts" || value === "mpeg-ts" || value === "transport") return "transport";
  if (value === "hls" || value === "m3u8") return "hls";
  if (value === "dash" || value === "mpd") return "dash";
  if (value === "progressive" || value === "mp4") return "progressive";
  return "unknown";
}

function prune(input: Record<string, ChannelPlaybackProfile>): Record<string, ChannelPlaybackProfile> {
  const entries = Object.entries(input);
  if (entries.length <= MAX_PROFILES) return input;
  entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
  return Object.fromEntries(entries.slice(0, MAX_PROFILES));
}

async function loadProfiles(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const stored = await storage.getItem<Record<string, ChannelPlaybackProfile>>(STORAGE_KEY, {});
    cached = stored && typeof stored === "object" ? prune(stored) : {};
    loaded = true;
  })();
  try { await loadPromise; } finally { loadPromise = null; }
}

void loadProfiles().catch(() => undefined);

function publish() {
  for (const listener of Array.from(listeners)) {
    try { listener(); } catch {}
  }
}

function persist() {
  const snapshot = prune({ ...cached });
  cached = snapshot;
  persistChain = persistChain
    .catch(() => undefined)
    .then(() => storage.setItem(STORAGE_KEY, snapshot))
    .then(() => undefined);
}

function update(channelKey: string | undefined, updater: (current: ChannelPlaybackProfile) => ChannelPlaybackProfile) {
  const key = String(channelKey || "").trim();
  if (!key) return;
  const current = cached[key] || { declaredType: "unknown" as const, updatedAt: 0 };
  const next = updater(current);
  if (
    current.declaredType === next.declaredType &&
    current.confirmedType === next.confirmedType &&
    current.lastEngine === next.lastEngine
  ) return;
  cached = { ...cached, [key]: next };
  loaded = true;
  publish();
  persist();
}

export function rememberDeclaredStreamType(channelKey: string | undefined, rawType: unknown): void {
  const declaredType = normalizeType(rawType);
  update(channelKey, (current) => ({ ...current, declaredType, updatedAt: Date.now() }));
}

export function rememberConfirmedStreamType(
  channelKey: string | undefined,
  rawType: unknown,
  engine: PlaybackProfileEngine = "media3",
): void {
  const confirmed = normalizeType(rawType);
  if (confirmed === "unknown") return;
  update(channelKey, (current) => ({
    ...current,
    confirmedType: confirmed,
    lastEngine: engine,
    updatedAt: Date.now(),
  }));
}

export function rememberPlaybackEngine(channelKey: string | undefined, engine: PlaybackProfileEngine): void {
  update(channelKey, (current) => ({ ...current, lastEngine: engine, updatedAt: Date.now() }));
}

export function invalidateConfirmedStreamType(channelKey: string | undefined): void {
  const key = String(channelKey || "").trim();
  if (!key || !cached[key]?.confirmedType) return;
  const { confirmedType: _ignored, ...rest } = cached[key];
  cached = { ...cached, [key]: { ...rest, updatedAt: Date.now() } };
  publish();
  persist();
}

export function getChannelPlaybackProfile(channelKey: string | undefined): ChannelPlaybackProfile | undefined {
  const key = String(channelKey || "").trim();
  return key ? cached[key] : undefined;
}

export function useChannelPlaybackProfile(channelKey: string | undefined): ChannelPlaybackProfile | undefined {
  const [, setRevision] = useState(0);
  useEffect(() => {
    let mounted = true;
    void loadProfiles().then(() => { if (mounted) setRevision((value) => value + 1); });
    const listener = () => { if (mounted) setRevision((value) => value + 1); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);
  return getChannelPlaybackProfile(channelKey);
}
