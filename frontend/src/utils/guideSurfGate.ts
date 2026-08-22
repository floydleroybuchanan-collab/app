/**
 * Guide rapid-surf / foreground gate. Heavy silent guide/source rebuilds must
 * never compete with an active Guide canvas, D-pad surfing, preview startup, or
 * fullscreen playback. They can resume once the Guide relinquishes foreground.
 */

let surfingUntil = 0;
let guideScreenActive = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const settleListeners = new Set<() => void>();
const screenActiveListeners = new Set<(active: boolean) => void>();

export function markGuideSurfing(holdMs = 700): void {
  const until = Date.now() + Math.max(120, holdMs);
  if (until > surfingUntil) surfingUntil = until;
  if (settleTimer) clearTimeout(settleTimer);
  const wait = Math.max(16, surfingUntil - Date.now() + 24);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (isGuideSurfing()) {
      markGuideSurfing(Math.max(0, surfingUntil - Date.now()));
      return;
    }
    for (const listener of Array.from(settleListeners)) {
      if (!settleListeners.has(listener)) continue;
      try { listener(); } catch {}
    }
  }, wait);
}

export function isGuideSurfing(): boolean {
  return Date.now() < surfingUntil;
}

export function setGuideScreenActive(active: boolean): void {
  const next = !!active;
  if (next === guideScreenActive) return;
  guideScreenActive = next;
  for (const listener of Array.from(screenActiveListeners)) {
    if (!screenActiveListeners.has(listener)) continue;
    try { listener(next); } catch {}
  }
}

export function isGuideScreenActive(): boolean {
  return guideScreenActive;
}

export function onGuideSurfSettled(listener: () => void): () => void {
  settleListeners.add(listener);
  return () => { settleListeners.delete(listener); };
}

export function onGuideScreenActiveChanged(listener: (active: boolean) => void): () => void {
  screenActiveListeners.add(listener);
  return () => { screenActiveListeners.delete(listener); };
}
