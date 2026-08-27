import React from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import { Channel } from "@/src/api";
import { PurpleChannelCollection } from "@/src/components/PurpleChannelCollection";
import { catalogKind } from "@/src/core/sourceParsing";

const matchesMovies = (channel: Channel) =>
  catalogKind(channel.url || "") === "movie" ||
  /movie|movies|cinema|film|films|vod/i.test(`${channel.group || ""} ${channel.name || ""}`);

function MoviesScreenContent() {
  return (
    <PurpleChannelCollection
      active="/movies"
      title="Movies"
      subtitle="Browse movie channels"
      matcher={matchesMovies}
    />
  );
}

export default function MoviesScreen() {
  return (
    <FocusedTabMount>
      <MoviesScreenContent />
    </FocusedTabMount>
  );
}
