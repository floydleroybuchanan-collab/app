import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

import {
  normalizePlaybackProfileType as normalizeType,
  normalizeStoredPlaybackProfiles,
  type ChannelPlaybackProfile,
  type PlaybackProfileEngine,
} from "./playbackProfileMigration";
export type { ChannelPlaybackProfile, PlaybackProfileEngine, PlaybackProfileType } from "./playbackProfileMigration";

const STORAGE_KEY = "gs_channel_playback_profiles_v1";
const MAX_PROFILES = 512;
let cached: Record<string, ChannelPlaybackProfile> = {};
let loaded = false;
let loadPromise: Promise<void> | null = null;
let persistChain: Promise<void> = Promise.resolve();
let mutationRevision = 0;
const listeners = new Set<() => void>();

function prune(input: Record<string, ChannelPlaybackProfile>): Record<string, ChannelPlaybackProfile> {
  const entries = Object.entries(input);
  if (entries.length <= MAX_PROFILES) return input;
  entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
  return Object.fromEntries(entries.slice(0, MAX_PROFILES));
}

async function loadProfiles(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  const revisionAtStart = mutationRevision;
  loadPromise = (async () => {
    const stored = await storage.getItem<unknown>(STORAGE_KEY, {});
    const storedProfiles = prune(normalizeStoredPlaybackProfiles(stored));
    cached = mutationRevision === revisionAtStart
      ? storedProfiles
      : prune({ ...storedProfiles, ...cached });
    loaded = true;
    // Persist the sanitized snapshot through the existing serial queue. An
    // in-flight update wins over an old backup's source/engine confirmation.
    persist();
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
  persistChain = persistChain
    .catch(() => undefined)
    .then(async () => {
      const pendingLoad = loadPromise;
      if (pendingLoad) await pendingLoad.catch(() => undefined);
      const snapshot = prune({ ...cached });
      cached = snapshot;
      await storage.setItem(STORAGE_KEY, snapshot);
    })
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
  mutationRevision += 1;
  cached = { ...cached, [key]: next };
  publish();
  persist();
}

export function rememberDeclaredStreamType(channelKey: string | undefined, rawType: unknown): void {
  const declaredType = normalizeType(rawType);
  update(channelKey, (current) => ({ ...current, declaredType, updatedAt: Date.now() }));
}

/**
 * Index the playlist's already-parsed stream types without opening any stream
 * connections. One bounded persistence write covers the whole catalog, which is
 * cheap for the current ~300-channel list and avoids hundreds of HEAD/GET probes.
 */
export function indexDeclaredStreamTypes(
  channels: readonly { id?: string | null; stream_type?: unknown }[],
): void {
  if (!channels.length) return;
  const now = Date.now();
  let changed = false;
  let next = cached;
  for (const channel of channels) {
    const key = String(channel.id || "").trim();
    if (!key) continue;
    const declaredType = normalizeType(channel.stream_type);
    const current = next[key] || { declaredType: "unknown" as const, updatedAt: 0 };
    if (current.declaredType === declaredType) continue;
    if (!changed) next = { ...cached };
    next[key] = { ...current, declaredType, updatedAt: now };
    changed = true;
  }
  if (!changed) return;
  mutationRevision += 1;
  cached = prune(next);
  publish();
  persist();
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
  mutationRevision += 1;
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
