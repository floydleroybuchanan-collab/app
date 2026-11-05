export type RefreshStage = "playlist-import" | "catalog-index" | "catalog-clock" | "fallback-cache" |
  "associated-guides" | "guide-ownership" | "legacy-custom-guide" | "primary-config" |
  "primary-queued" | "primary-lease" | "primary-database" | "primary-download" |
  "primary-decompress" | "primary-parse" | "primary-index" | "guide-match" | "match-publish";

const MAX_STAGES = 18;

export function createSourceRefreshTrace(clock = Date.now) {
  let active: { stage: RefreshStage; started: number } | null = null;
  const completed: { stage: RefreshStage; elapsedMs: number }[] = [];
  function finish(now = clock()) {
    if (!active) return;
    completed.push({ stage: active.stage, elapsedMs: Math.max(0, now - active.started) });
    if (completed.length > MAX_STAGES) completed.shift();
    active = null;
  }
  return {
    reset() { active = null; completed.length = 0; },
    enter(stage: RefreshStage) {
      if (active?.stage === stage) return;
      const now = clock();
      finish(now);
      active = { stage, started: now };
    },
    finish,
    read() {
      return {
        active: active ? { stage: active.stage, elapsedMs: Math.max(0, clock() - active.started) } : null,
        completed: completed.map(row => ({ ...row })),
      };
    },
  };
}

/** Only named stages and elapsed time are retained. No provider data enters this trace. */
export const sourceRefreshTrace = createSourceRefreshTrace();

export function recordNativeImportStage(phase: string) {
  switch (phase) {
    case "waiting-for-import-lease": sourceRefreshTrace.enter("primary-lease"); break;
    case "checking-guide-database": sourceRefreshTrace.enter("primary-database"); break;
    case "downloading": sourceRefreshTrace.enter("primary-download"); break;
    case "decompressing": sourceRefreshTrace.enter("primary-decompress"); break;
    case "parsing": sourceRefreshTrace.enter("primary-parse"); break;
    case "indexing": sourceRefreshTrace.enter("primary-index"); break;
  }
}
