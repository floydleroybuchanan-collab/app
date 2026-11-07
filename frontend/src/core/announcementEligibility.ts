type TimedNotice = { id: string; kind: string; expires_at: number; version_code: number };

export function nextAnnouncement<T extends TimedNotice>(
  notices: readonly T[],
  history: Record<string, { next: number }>,
  cooldown: number,
  version: number,
  now: number,
): { notice: T | null; wakeAt: number | null } {
  let wakeAt = Infinity;
  for (const notice of notices) {
    const expiry = notice.expires_at * 1000;
    if (!Number.isFinite(expiry) || expiry <= now || (notice.kind === "update" && notice.version_code <= version)) continue;
    const eligibleAt = Math.max(cooldown, history[notice.id]?.next || 0);
    if (eligibleAt <= now) return { notice, wakeAt: null };
    if (eligibleAt < expiry) wakeAt = Math.min(wakeAt, eligibleAt);
  }
  return { notice: null, wakeAt: Number.isFinite(wakeAt) ? wakeAt : null };
}
