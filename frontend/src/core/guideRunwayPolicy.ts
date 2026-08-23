export type GuideScanDirection = -1 | 1;

/**
 * Keep a modest symmetric runway. The native Guide already owns its own bounded
 * paint/query cache, so JS does not need eight-to-ten full pages of programme
 * objects resident at the same time. This is especially important when changing
 * group tabs quickly on low-memory Android TV boxes.
 */
export const GUIDE_PREFETCH_PAGES_AHEAD = 4;
export const GUIDE_PREFETCH_PAGES_BEHIND = 4;

type GuideRowIdentity = { id: string };

export type GuideRunwayPages = {
  ahead: number;
  behind: number;
};

/** Keep in sync with PROFILE_PAGES in guideSlidingCache.ts. */
const PROFILE_RUNWAY: Record<string, GuideRunwayPages> = {
  normal: { ahead: GUIDE_PREFETCH_PAGES_AHEAD, behind: GUIDE_PREFETCH_PAGES_BEHIND },
  weak: { ahead: 3, behind: 3 },
  max_preview: {
    ahead: GUIDE_PREFETCH_PAGES_AHEAD + 1,
    behind: GUIDE_PREFETCH_PAGES_BEHIND + 1,
  },
};

/** Resolve direction-aware runway page counts from the device power profile. */
export function guideRunwayPagesForProfile(
  profile: string | null | undefined,
): GuideRunwayPages {
  if (profile === "weak" || profile === "max_preview") return PROFILE_RUNWAY[profile];
  return PROFILE_RUNWAY.normal;
}

/**
 * Build a direction-aware EPG data runway in the exact order shown on screen.
 * The runway stays intentionally smaller than the native paint cache; rows that
 * leave the expanded hysteresis keep set are discarded by retain*.
 */
export function buildGuideRunwayIds(
  rows: GuideRowIdentity[],
  focusedIndex: number,
  itemsPerPage: number,
  direction: GuideScanDirection,
  pages?: Partial<GuideRunwayPages> | string | null,
): string[] {
  if (!rows.length) return [];
  const resolved =
    typeof pages === "string" || pages == null
      ? guideRunwayPagesForProfile(pages)
      : {
          ahead: pages.ahead ?? GUIDE_PREFETCH_PAGES_AHEAD,
          behind: pages.behind ?? GUIDE_PREFETCH_PAGES_BEHIND,
        };
  const pageSize = Math.max(1, Math.floor(itemsPerPage));
  const safeIndex = Math.max(0, Math.min(rows.length - 1, Math.floor(focusedIndex)));
  const currentPageStart = Math.floor(safeIndex / pageSize) * pageSize;
  const beforePages = direction < 0 ? resolved.ahead : resolved.behind;
  const afterPages = direction < 0 ? resolved.behind : resolved.ahead;
  const start = Math.max(0, currentPageStart - beforePages * pageSize);
  const end = Math.min(rows.length, currentPageStart + (afterPages + 1) * pageSize);
  const ids: string[] = [];
  for (let index = start; index < end; index++) {
    const id = rows[index]?.id;
    if (id) ids.push(id);
  }
  return ids;
}
