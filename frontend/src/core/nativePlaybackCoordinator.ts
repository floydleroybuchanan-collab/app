import { createPlaybackCoordinator } from "@/src/core/serializedPlaybackCoordinator";
import {
  getNativePlaybackOwner,
  pauseNativePlayback,
  stopNativeFullscreen,
  stopNativePreview,
} from "@/src/nativePlayback";
import {
  getNativeVlcOwner,
  pauseNativeVlcPlayback,
  stopNativeVlcFullscreen,
  stopNativeVlcPreview,
} from "@/src/nativeVlcPlayback";

const coordinator = createPlaybackCoordinator({
  owner: (engine) => engine === "media3" ? getNativePlaybackOwner() : getNativeVlcOwner(),
  stop: async (engine, role, releasePlayer) => {
    if (engine === "media3") {
      if (role === "preview") await stopNativePreview(releasePlayer);
      else await stopNativeFullscreen(releasePlayer);
    } else if (role === "preview") await stopNativeVlcPreview(releasePlayer);
    else await stopNativeVlcFullscreen(releasePlayer);
  },
  pause: (engine) => {
    if (engine === "media3") pauseNativePlayback();
    else pauseNativeVlcPlayback();
  },
});

export const activateNativePlaybackEngine = coordinator.activate;
export const releaseNativePlaybackRole = coordinator.release;
export const runNativePlaybackCommand = coordinator.command;
export const pauseActiveNativePlayback = coordinator.pause;
export const getActiveNativePlaybackEngine = coordinator.current;
