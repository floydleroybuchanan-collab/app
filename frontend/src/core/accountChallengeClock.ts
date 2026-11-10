import type { ChallengeStatus } from "../auth/securityApi";

export function challengeNeedsDeadline(kind: string, status: ChallengeStatus): boolean {
  return status === "waiting" ||
    ((kind === "reset" || kind === "registration") && (status === "approved" || status === "consumed"));
}

/** One foreground clock, ending at the exact deadline or on owner cleanup. */
export function startChallengeClock(expiresAt: number, onTick: (now: number) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const now = Date.now();
    onTick(now);
    if (now < expiresAt) timer = setTimeout(tick, Math.min(1000, expiresAt - now));
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}
