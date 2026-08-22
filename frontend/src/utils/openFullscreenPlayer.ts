import type { Router } from "expo-router";
import {
  stopPreviewForFullscreen,
  waitForFullscreenRelease,
} from "@/src/core/playbackSession";

let handoffSequence = 0;

/**
 * Single-owner handoff. A new fullscreen route is never mounted while an older
 * fullscreen MediaCodec release is still settling, and preview teardown also
 * completes before fullscreen claims the single native PlayerView.
 */
export function openFullscreenPlayer(
  router: Pick<Router, "push">,
  channelId: string,
  options?: { returnToGuide?: boolean },
): void {
  if (!channelId) return;
  const sequence = ++handoffSequence;

  void waitForFullscreenRelease()
    .then(() => stopPreviewForFullscreen())
    .catch(() => undefined)
    .then(() => {
      if (sequence !== handoffSequence) return;
      router.push({
        pathname: "/player",
        params: {
          channelId,
          returnToGuide: options?.returnToGuide ? "1" : undefined,
        },
      });
    });
}
