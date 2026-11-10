import React from "react";
import { Image } from "react-native";

const ART: [RegExp, number][] = [
  [/delete|remove|clear|trash|cloud|download|upload|backup|restore|save|import|export/i, require("../../assets/glass/settings_storage.png")],
  [/lock|pin|shield|parental|key/i, require("../../assets/glass/settings_security.png")],
  [/epg|guide|calendar|time|schedule|day/i, require("../../assets/glass/settings_epg.png")],
  [/playlist|provider|source|m3u|xtream|url|link/i, require("../../assets/glass/settings_provider.png")],
  [/group|channel|list/i, require("../../assets/glass/nav_shows.png")],
  [/refresh|update|sync|match|repair/i, require("../../assets/glass/settings_notifications.png")],
  [/play|video|preview/i, require("../../assets/glass/settings_playback.png")],
  [/account|person|user/i, require("../../assets/glass/settings_account.png")],
  [/color|theme|appearance/i, require("../../assets/glass/settings_appearance.png")],
  [/info|about|help/i, require("../../assets/glass/settings_about.png")],
];
const FALLBACK = require("../../assets/glass/nav_platforms.png");

/** Glass artwork chosen from a button's name or purpose; shared across Settings pages. */
export const GlassIcon = React.memo(function GlassIcon({ name, size = 20 }: { name: string; size?: number }) {
  const source = ART.find(([pattern]) => pattern.test(name))?.[1] ?? FALLBACK;
  return <Image source={source} style={{ width: size, height: size }} resizeMode="contain" fadeDuration={0} />;
});
