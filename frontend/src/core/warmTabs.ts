/**
 * Tab screens that were just left stay mounted for a short while, so going back to them is instant.
 * Only a few are kept, they are released on a timer, and all of them are released the moment memory
 * is tight, the app goes to the background, or another page (the player) takes over.
 */
export const WARM_TAB_MS = 45_000;
export const WARM_TAB_MAX = 2;

export type WarmTabRegistry = {
  /** Keep a screen warm. The oldest ones beyond the limit are released. */
  add(id: unknown, release: () => void): void;
  remove(id: unknown): void;
  releaseAll(): void;
  size(): number;
};

export function createWarmTabRegistry(max = WARM_TAB_MAX): WarmTabRegistry {
  let entries: { id: unknown; release: () => void }[] = [];
  return {
    add(id, release) {
      entries = entries.filter((entry) => entry.id !== id);
      entries.push({ id, release });
      while (entries.length > max) entries.shift()?.release();
    },
    remove(id) {
      entries = entries.filter((entry) => entry.id !== id);
    },
    releaseAll() {
      const all = entries;
      entries = [];
      for (const entry of all) entry.release();
    },
    size: () => entries.length,
  };
}

export const warmTabs = createWarmTabRegistry();
