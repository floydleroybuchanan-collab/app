import React from "react";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { MediaLabVodContent } from "@/src/components/MediaLabVodContent";
export default function VodSettingsScreen() {
  return <PurpleTvShell active="/settings"><MediaLabVodContent initialSection="settings" settings /></PurpleTvShell>;
}
