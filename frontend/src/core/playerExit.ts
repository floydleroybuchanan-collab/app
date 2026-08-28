type MutableValue<T> = { current: T };
const exitOwners = new WeakMap<MutableValue<boolean>, object>();

/** One fullscreen exit owns teardown; stale completions never navigate a newer route. */
export async function requestPlayerExit({
  inFlight,
  generation,
  isCurrentRoute,
  stop,
  navigate,
}: {
  inFlight: MutableValue<boolean>;
  generation: MutableValue<number>;
  isCurrentRoute: () => boolean;
  stop: () => Promise<void>;
  navigate: () => void;
}): Promise<boolean> {
  if (inFlight.current || !isCurrentRoute()) return false;
  inFlight.current = true;
  const owner = {};
  exitOwners.set(inFlight, owner);
  const exitGeneration = ++generation.current;
  let navigated = false;
  try {
    await stop();
    if (generation.current !== exitGeneration || !isCurrentRoute()) return false;
    navigate();
    navigated = true;
    return true;
  } finally {
    // Canceled exits must not strand a later tune, or clear another exit that
    // has since taken ownership of the same screen's in-flight flag.
    if (exitOwners.get(inFlight) === owner) {
      exitOwners.delete(inFlight);
      if (!navigated) inFlight.current = false;
    }
  }
}
