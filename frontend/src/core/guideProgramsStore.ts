import { useCallback, useSyncExternalStore } from "react";
import type { Program } from "@/src/api";

/**
 * TV guide programme cache deliberately lives outside the app-wide React context.
 * SQLite/native EPG storage is authoritative. This JS layer is only a bounded,
 * row-local pointer cache so guide focus never depends on an all-channel React
 * update completing first.
 */
const EMPTY_PROGRAMS: Program[] = [];
let maxProgrammeRows = 384;

let activeWindowKey = "";
const programsByChannelId = new Map<string, Program[]>();
const listenersByChannelId = new Map<string, Set<() => void>>();

function notify(channelId: string): void {
  const listeners = listenersByChannelId.get(channelId);
  if (!listeners) return;
  for (const listener of Array.from(listeners)) {
    try { listener(); } catch {}
  }
}

function subscribe(channelId: string, listener: () => void): () => void {
  if (!channelId) return () => undefined;
  let listeners = listenersByChannelId.get(channelId);
  if (!listeners) {
    listeners = new Set();
    listenersByChannelId.set(channelId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = listenersByChannelId.get(channelId);
    current?.delete(listener);
    if (current && current.size === 0) listenersByChannelId.delete(channelId);
  };
}

function trim(keepIds: ReadonlySet<string> = new Set(), force = false): void {
  if (programsByChannelId.size <= maxProgrammeRows) return;
  for (const channelId of Array.from(programsByChannelId.keys())) {
    if (programsByChannelId.size <= maxProgrammeRows) return;
    if (keepIds.has(channelId)) continue;
    if (!force && (listenersByChannelId.get(channelId)?.size || 0) > 0) continue;
    programsByChannelId.delete(channelId);
    notify(channelId);
  }
}

export function setGuideProgramRowLimit(limit: number): void {
  maxProgrammeRows = Math.max(96, Math.min(768, Math.floor(limit || 384)));
  trim();
}

/** Memory-pressure trim. Critical force-evicts subscribed off-keep rows. */
export function trimGuideProgramRows(keepIds: Iterable<string>, critical = false): void {
  const keep = new Set(Array.from(keepIds).filter(Boolean));
  const previous = maxProgrammeRows;
  maxProgrammeRows = critical
    ? Math.max(96, keep.size)
    : Math.max(128, Math.floor(previous / 2), keep.size);
  trim(keep, critical);
  maxProgrammeRows = previous;
}

export function getGuidePrograms(channelId: string | null | undefined): Program[] {
  if (!channelId) return EMPTY_PROGRAMS;
  return programsByChannelId.get(channelId) || EMPTY_PROGRAMS;
}

export function hasGuidePrograms(channelId: string | null | undefined): boolean {
  return getGuidePrograms(channelId).length > 0;
}

export type GuideProgramRowState = "loading" | "ready" | "empty";

export function getGuideProgramRowState(channelId: string | null | undefined): GuideProgramRowState {
  if (!channelId || !programsByChannelId.has(channelId)) return "loading";
  return (programsByChannelId.get(channelId)?.length || 0) > 0 ? "ready" : "empty";
}

export function listCachedGuideChannelIds(): string[] {
  return Array.from(programsByChannelId.keys());
}

export function applyGuidePrograms(
  windowKey: string,
  delta: Record<string, Program[]>,
): void {
  const nextWindow = windowKey || activeWindowKey;
  if (nextWindow && activeWindowKey && nextWindow !== activeWindowKey) {
    const previousIds = Array.from(programsByChannelId.keys());
    programsByChannelId.clear();
    for (const id of previousIds) notify(id);
  }
  if (nextWindow) activeWindowKey = nextWindow;

  for (const [channelId, programs] of Object.entries(delta)) {
    if (!channelId || !Array.isArray(programs)) continue;
    const previous = programsByChannelId.get(channelId);
    if (previous === programs) continue;
    programsByChannelId.delete(channelId);
    programsByChannelId.set(channelId, programs);
    notify(channelId);
  }
  trim();
}

export function clearGuidePrograms(): void {
  const ids = Array.from(programsByChannelId.keys());
  programsByChannelId.clear();
  activeWindowKey = "";
  for (const id of ids) notify(id);
}

export type RetainGuideProgramsOptions = { force?: boolean };

export function retainGuidePrograms(
  keepIds: Iterable<string>,
  options?: RetainGuideProgramsOptions,
): void {
  const keep = keepIds instanceof Set ? keepIds : new Set(Array.from(keepIds).filter(Boolean));
  if (!keep.size) return;
  const force = !!options?.force;
  const drop: string[] = [];
  for (const id of programsByChannelId.keys()) {
    if (keep.has(id)) continue;
    if (!force && (listenersByChannelId.get(id)?.size || 0) > 0) continue;
    drop.push(id);
  }
  for (const id of drop) {
    programsByChannelId.delete(id);
    notify(id);
  }
}

export function makeGuideProgramWindowKey(start: string, end: string, _guideEpoch = 0): string {
  return `${start}|${end}`;
}

export function useGuidePrograms(channelId: string | null | undefined): Program[] {
  const subscribeForChannel = useCallback(
    (listener: () => void) => subscribe(channelId || "", listener),
    [channelId],
  );
  const getSnapshot = useCallback(() => getGuidePrograms(channelId), [channelId]);
  return useSyncExternalStore(subscribeForChannel, getSnapshot, getSnapshot);
}
