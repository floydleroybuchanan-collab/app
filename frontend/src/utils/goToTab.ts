import type { Router } from "expo-router";

/**
 * Every tab page lives in the ONE (tabs) navigator at the bottom of the root stack.
 * From a page stacked above it (player, multiview, playlists, EPG and group pages)
 * return to that navigator; REPLACE there would build a second copy of every tab
 * (Live TV, Guide, VOD...) on top of the first and keep both in memory.
 * Inside the tabs, switching tabs stays a plain replace.
 */
export function goToTab(router: Pick<Router, "replace" | "dismissTo" | "canDismiss">, href: string): void {
  if (router.canDismiss()) router.dismissTo(href as any);
  else router.replace(href as any);
}
