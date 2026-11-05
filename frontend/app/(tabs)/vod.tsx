import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { MediaLabVodContent } from "@/src/components/MediaLabVodContent";

export default function VideoOnDemandScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [player, setPlayer] = useState(false);
  return <PurpleTvShell active="/vod" immersive={player}>
    <MediaLabVodContent initialSection={section || "home"} onPlayerChange={setPlayer} />
  </PurpleTvShell>;
}
