import type { Engine } from "./streamPolicy";
import type { SessionRole } from "./playbackSession";

type ActiveEngine = { engine: Engine; role: SessionRole };
type NativeOwner = SessionRole | "none";
type Dependencies = {
  owner: (engine: Engine) => Promise<NativeOwner>;
  stop: (engine: Engine, role: SessionRole, releasePlayer: boolean) => Promise<void>;
  pause: (engine: Engine) => void;
};

/** The queue includes prepare and controls, not just the preceding stop. */
export function createPlaybackCoordinator(native: Dependencies) {
  let active: ActiveEngine | null = null;
  let operation: Promise<void> = Promise.resolve();

  function enqueue(task: () => Promise<void>): Promise<void> {
    const next = operation.catch(() => undefined).then(task);
    operation = next.catch(() => undefined);
    return next;
  }

  async function stopNativeOwner(engine: Engine, role?: SessionRole): Promise<void> {
    const owner = await native.owner(engine);
    if (owner !== "none" && (!role || owner === role)) {
      await native.stop(engine, owner, true);
    }
  }

  function activate(role: SessionRole, engine: Engine, isCurrent: () => boolean, prepare: () => void): Promise<void> {
    return enqueue(async () => {
      // Also validate at runtime: restored or stale JS state must not activate
      // an engine that is no longer present in the native application.
      if (engine !== "media3") throw new Error("Unsupported playback engine");
      // Cancelled work must not retire a newer fullscreen/preview decoder.
      if (!isCurrent()) return;
      if (active?.engine !== engine || active.role !== role) {
        if (active) {
          await native.stop(active.engine, active.role, active.engine !== engine);
          active = null;
        } else {
          // Recover native ownership after JS reload. A failed release is fatal
          // to this activation: never start another decoder on an unknown owner.
          await stopNativeOwner("media3");
        }
      }
      if (!isCurrent()) return;
      active = { engine, role };
      prepare();
    });
  }

  function release(role: SessionRole): Promise<void> {
    return enqueue(async () => {
      if (active) {
        if (active.role !== role) return;
        await native.stop(active.engine, active.role, true);
        active = null;
        return;
      }
      // A preview cleanup after JS reload must not stop native fullscreen.
      await stopNativeOwner("media3", role);
    });
  }

  function command(role: SessionRole, engine: Engine, isCurrent: () => boolean, run: () => void): Promise<void> {
    return enqueue(async () => {
      if (active?.role === role && active.engine === engine && isCurrent()) run();
    });
  }

  function pause(role: SessionRole): Promise<void> {
    return enqueue(async () => {
      if (active?.role === role) native.pause(active.engine);
    });
  }

  return { activate, release, command, pause, current: () => active ? { ...active } : null };
}
