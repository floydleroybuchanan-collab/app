/** Navigation focus can remain true while Android backgrounds the Activity. */
export function isAppUiForeground(state: string | null | undefined): boolean {
  return state !== "background" && state !== "inactive";
}

/** Drop queued semantic remote events after their originating route has left. */
export function acceptsQuickActionsContext(pathname: string | null | undefined, context: "guide" | "player"): boolean {
  const route = `/${context}`;
  return pathname === route || !!pathname?.startsWith(`${route}/`);
}

/** Fullscreen stays mounted while backgrounded; its remote owner must survive modal dismissal. */
export function overlayRestoreContext(pathname: string | null | undefined, foreground: boolean): "player" | "guide" | "default" {
  if (acceptsQuickActionsContext(pathname, "player")) return "player";
  if (foreground && acceptsQuickActionsContext(pathname, "guide")) return "guide";
  return "default";
}
