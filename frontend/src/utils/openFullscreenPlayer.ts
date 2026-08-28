import type { Router } from "expo-router";
import { Alert } from "react-native";
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
  options?: { returnToGuide?: boolean; returnGuideGroup?: string },
): void {
  if (!channelId) return;
  const sequence = ++handoffSequence;
  const showReleaseFailure = () => {
    if (sequence !== handoffSequence) return;
    Alert.alert(
      "Playback is still stopping",
      "The previous player could not confirm that it had stopped. No new stream was started. Wait a moment and try again. If playback stays blocked, force-stop CharmIPTV in Android Settings, then reopen it.",
    );
  };

  void waitForFullscreenRelease()
    .then((outcome) => outcome.status === "completed" && sequence === handoffSequence ? stopPreviewForFullscreen() : outcome)
    .then((outcome) => {
      if (sequence !== handoffSequence || outcome.status === "superseded") return;
      if (outcome.status === "failed") { showReleaseFailure(); return; }
      router.push({
        pathname: "/player",
        params: {
          channelId,
          returnToGuide: options?.returnToGuide ? "1" : undefined,
          returnGuideGroup: options?.returnToGuide && options.returnGuideGroup
            ? options.returnGuideGroup
            : undefined,
        },
      });
    })
    .catch(showReleaseFailure);
}
