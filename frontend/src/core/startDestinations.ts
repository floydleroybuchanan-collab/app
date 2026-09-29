/** One catalog for Settings and cold-start routing. Keep persisted values stable. */
export const START_DESTINATIONS = [
  { value: "home", label: "Home / Live TV", route: "/" },
  { value: "guide", label: "TV Guide", route: "/guide" },
  { value: "vod", label: "Video On Demand", route: "/vod" },
  { value: "channels", label: "Channels", route: "/channels" },
  { value: "movies", label: "Movies", route: "/movies" },
  { value: "series", label: "Series", route: "/series" },
  { value: "favorites", label: "Favorites", route: "/favorites" },
  { value: "search", label: "Search", route: "/search" },
  { value: "reminders", label: "My Reminders", route: "/reminders" },
  { value: "multiview", label: "Multiview", route: "/multiview" },
  { value: "settings", label: "Settings", route: "/settings" },
  { value: "last_channel", label: "Last channel", route: "/" },
] as const;

export type StartScreen = typeof START_DESTINATIONS[number]["value"];
export function resolveStartScreen(value: unknown): StartScreen {
  return START_DESTINATIONS.some(item => item.value === value) ? value as StartScreen : "home";
}

export function startupTarget(value: unknown, options: {
  nativeVod: boolean; multiviewAllowed: boolean; channelIds: readonly string[]; lastChannelId?: string | null;
}): { route: string; channelId?: string } {
  const screen = resolveStartScreen(value);
  if (screen === "vod" && !options.nativeVod) return { route: "/" };
  if (screen === "multiview" && !options.multiviewAllowed) return { route: "/" };
  if (screen === "last_channel") {
    return options.lastChannelId && options.channelIds.includes(options.lastChannelId)
      ? { route: "/player", channelId: options.lastChannelId } : { route: "/" };
  }
  return { route: START_DESTINATIONS.find(item => item.value === screen)!.route };
}
