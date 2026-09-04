export type IconRailTimeoutMinutes = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type IconRailPreferences = { enabled: boolean; timeoutMinutes: IconRailTimeoutMinutes };
export const DEFAULT_ICON_RAIL_PREFERENCES: IconRailPreferences = { enabled: true, timeoutMinutes: 3 };
export const ICON_RAIL_TIMEOUT_OPTIONS: { label: string; value: IconRailTimeoutMinutes }[] = [
  ...Array.from({ length: 9 }, (_, index) => ({ label: `${index + 1} minute${index ? "s" : ""}`, value: (index + 1) as IconRailTimeoutMinutes })),
  { label: "Never Leaves", value: 0 },
];
export function normalizeIconRailPreferences(raw: Partial<IconRailPreferences> | null | undefined): IconRailPreferences {
  const timeout = raw?.timeoutMinutes;
  return { enabled: raw?.enabled !== false, timeoutMinutes: typeof timeout === "number" && Number.isInteger(timeout) && timeout >= 0 && timeout <= 9 ? timeout as IconRailTimeoutMinutes : 3 };
}
export function railIdleRemainingMs(timeoutMinutes: IconRailTimeoutMinutes, lastInteractionAt: number, now: number): number | null {
  return timeoutMinutes === 0 ? null : Math.max(0, timeoutMinutes * 60_000 - Math.max(0, now - lastInteractionAt));
}
