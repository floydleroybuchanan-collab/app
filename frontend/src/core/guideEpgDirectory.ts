export type GuideDirectoryRow = { id: string; name: string };
export type GuideDirectoryPage = { total: number; rows: GuideDirectoryRow[] };

export function guideEpgSearchTerm(name: string): string {
  return name.replace(/\b(?:UHD|FHD|HD|SD|HEVC|H265|4K)\b/gi, "").replace(/\s+/g, " ").trim();
}

/** Invalidation happens at scheduling time, not only when the next request starts. */
export function createGuideDirectoryOwner() {
  let revision = 0;
  return {
    invalidate: () => ++revision,
    async load(read: () => Promise<GuideDirectoryPage>, apply: (page: GuideDirectoryPage) => void, fail: () => void) {
      const mine = ++revision;
      try { const page = await read(); if (mine === revision) apply(page); }
      catch { if (mine === revision) fail(); }
    },
  };
}
