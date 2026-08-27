import type { Engine } from "@/src/core/streamPolicy";
import type { SessionRole } from "@/src/core/playbackSession";
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

type ActiveEngine = { engine: Engine; role: SessionRole };

let active: ActiveEngine | null = null;
let operation: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = operation.catch(() => undefined).then(task);
  operation = next.catch(() => undefined);
  return next;
}

async function stopEngine(engine: Engine, role: SessionRole, releasePlayer: boolean): Promise<void> {
  if (engine === "media3") {
    if (role === "preview") await stopNativePreview(releasePlayer);
    else await stopNativeFullscreen(releasePlayer);
    return;
  }
  if (role === "preview") await stopNativeVlcPreview(releasePlayer);
  else await stopNativeVlcFullscreen(releasePlayer);
}

async function stopNativeOwner(engine: Engine): Promise<void> {
  try {
    const owner = engine === "media3" ? await getNativePlaybackOwner() : await getNativeVlcOwner();
    if (owner === "preview") await stopEngine(engine, "preview", true);
    else if (owner === "fullscreen") await stopEngine(engine, "fullscreen", true);
  } catch {
    // A missing/unloading native module must not prevent cleanup of the other
    // engine. The next operation still proceeds through this same serial queue.
  }
}

/**
 * The only engine handoff gate in the app. Every transition is serialized and
 * the old native owner acknowledges release before the next engine may prepare.
 */
export function activateNativePlaybackEngine(role: SessionRole, engine: Engine): Promise<void> {
  return enqueue(async () => {
    if (active?.engine === engine && active.role === role) return;

    if (active) {
      // Cross-engine handoffs destroy the old player instance; same-engine
      // preview/fullscreen handoffs may retain the empty player shell only.
      await stopEngine(active.engine, active.role, active.engine !== engine);
    } else {
      // Recover safely after a JS reload: discover and retire any native owner
      // that outlived the module-level coordinator state.
      await stopNativeOwner("media3");
      await stopNativeOwner("vlc");
    }

    active = { engine, role };
  });
}

export function releaseNativePlaybackRole(role: SessionRole): Promise<void> {
  return enqueue(async () => {
    if (active?.role === role) {
      const current = active;
      active = null;
      await stopEngine(current.engine, current.role, true);
      return;
    }

    // A stale preview unmount can arrive after fullscreen has acquired the
    // singleton decoder (and vice versa). It must never release the other role.
    if (active) return;

    // A native owner can survive Fast Refresh or a JS exception. Querying both
    // engines here is defensive cleanup, performed sequentially rather than as
    // two competing stop operations.
    await stopNativeOwner("media3");
    await stopNativeOwner("vlc");
  });
}

export function pauseActiveNativePlayback(role: SessionRole): void {
  if (active?.role !== role) return;
  if (active.engine === "media3") pauseNativePlayback();
  else pauseNativeVlcPlayback();
}

export function getActiveNativePlaybackEngine(): ActiveEngine | null {
  return active ? { ...active } : null;
}

export function resetNativePlaybackCoordinatorForTests(): void {
  active = null;
  operation = Promise.resolve();
}
