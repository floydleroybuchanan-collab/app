import { createPlaybackCoordinator } from "@/src/core/serializedPlaybackCoordinator";
import {
  getNativePlaybackOwner,
  pauseNativePlayback,
  stopNativeFullscreen,
  stopNativePreview,
} from "@/src/nativePlayback";
const coordinator = createPlaybackCoordinator({
  owner: () => getNativePlaybackOwner(),
  stop: async (_engine, role, releasePlayer) => {
    if (role === "preview") await stopNativePreview(releasePlayer);
    else await stopNativeFullscreen(releasePlayer);
  },
  pause: () => pauseNativePlayback(),
});

export const activateNativePlaybackEngine = coordinator.activate;
export const releaseNativePlaybackRole = coordinator.release;
export const runNativePlaybackCommand = coordinator.command;
export const pauseActiveNativePlayback = coordinator.pause;
export const getActiveNativePlaybackEngine = coordinator.current;
