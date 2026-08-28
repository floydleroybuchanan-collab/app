/**
 * Playback ownership registry for preview vs fullscreen.
 * Kept platform-agnostic so it can be unit-tested outside React Native.
 */

export type SessionRole = "preview" | "fullscreen";
export type SessionPhase = "idle" | "preparing" | "playing" | "recovering" | "failed";
export type SessionFailReason =
  | "start-timeout"
  | "stream-error"
  | "unsupported-protocol"
  | "user-stop"
  | "superseded"
  | "crashed";

type StopFn = () => void | Promise<void>;
type NativeRoleFn = (role: SessionRole) => void | Promise<void>;
type RoleState = {
  generation: number;
  stops: Set<StopFn>;
  phase: SessionPhase;
  reason: SessionFailReason | null;
};

function createRole(): RoleState {
  return { generation: 0, stops: new Set(), phase: "idle", reason: null };
}

const roles: Record<SessionRole, RoleState> = {
  preview: createRole(),
  fullscreen: createRole(),
};
let fullscreenReserved = false;
let fullscreenReservationRevision = 0;
let ownershipRevision = 0;
let nativeReleaseHandler: NativeRoleFn | null = null;
let nativePauseHandler: NativeRoleFn | null = null;
const roleStopPromises: Record<SessionRole, Promise<void> | null> = {
  preview: null,
  fullscreen: null,
};
const ownershipListeners = new Set<() => void>();

function publishOwnership(): void {
  ownershipRevision += 1;
  for (const listener of Array.from(ownershipListeners)) {
    try { listener(); } catch {}
  }
}

function reserveFullscreen(): void {
  fullscreenReserved = true;
  fullscreenReservationRevision += 1;
}

function invokeStops(role: SessionRole): Promise<void> {
  const state = roles[role];
  const pending: Promise<void>[] = [];
  for (const stop of Array.from(state.stops)) {
    try {
      const result = stop();
      if (result && typeof result.then === "function") pending.push(result);
    } catch {}
  }
  state.stops.clear();
  return Promise.allSettled(pending).then(() => undefined);
}

async function invokeNative(handler: NativeRoleFn | null, role: SessionRole): Promise<void> {
  if (!handler) return;
  try { await handler(role); } catch {}
}

export function setNativePlaybackReleaseHandler(handler: NativeRoleFn | null): void {
  nativeReleaseHandler = handler;
}

export function setNativePlaybackPauseHandler(handler: NativeRoleFn | null): void {
  nativePauseHandler = handler;
}

export function subscribePlaybackOwnership(listener: () => void): () => void {
  ownershipListeners.add(listener);
  return () => ownershipListeners.delete(listener);
}

export function getPlaybackOwnershipRevision(): number {
  return ownershipRevision;
}

export function isPreviewPlaybackAllowed(): boolean {
  return !fullscreenReserved &&
    roles.fullscreen.phase === "idle" &&
    !roleStopPromises.fullscreen &&
    !roleStopPromises.preview;
}

export function beginSession(role: SessionRole): number {
  if (role === "preview" && !isPreviewPlaybackAllowed()) {
    const state = roles.preview;
    state.generation += 1;
    state.phase = "idle";
    state.reason = "superseded";
    publishOwnership();
    return 0;
  }

  if (role === "fullscreen") {
    reserveFullscreen();
    const preview = roles.preview;
    // Fullscreen entry must wait on stopPreviewForFullscreen before this point.
    // If a caller violates that handoff, never start a second native release in
    // parallel; invalidate only the JS callbacks and let the existing stop own it.
    void invokeStops("preview");
    preview.generation += 1;
    preview.phase = "idle";
    preview.reason = "superseded";
  }

  const state = roles[role];
  // Every new generation invalidates and drains callbacks from the previous
  // generation. Fullscreen channel changes still keep the singleton Media3
  // player alive because native release is not invoked here.
  void invokeStops(role);
  state.generation += 1;
  state.phase = "preparing";
  state.reason = null;
  publishOwnership();
  return state.generation;
}

export function getSessionGeneration(role: SessionRole): number {
  return roles[role].generation;
}

export function getSessionPhase(role: SessionRole): SessionPhase {
  return roles[role].phase;
}

export function getSessionReason(role: SessionRole): SessionFailReason | null {
  return roles[role].reason;
}

export function isSessionCurrent(role: SessionRole, generation: number): boolean {
  return roles[role].generation === generation;
}

export function registerSessionStop(role: SessionRole, generation: number, stop: StopFn): () => void {
  const state = roles[role];
  if (generation !== state.generation) return () => undefined;
  state.stops.add(stop);
  return () => state.stops.delete(stop);
}

export function setSessionPhase(
  role: SessionRole,
  generation: number,
  phase: SessionPhase,
  reason: SessionFailReason | null = null,
): boolean {
  const state = roles[role];
  if (generation !== state.generation) return false;
  state.phase = phase;
  state.reason = reason;
  publishOwnership();
  return true;
}

/** Resolves after any currently active preview decoder/native stop finishes. */
export function waitForPreviewRelease(): Promise<void> {
  return roleStopPromises.preview ?? Promise.resolve();
}

/**
 * Resolves only after the current fullscreen Media3/MediaCodec teardown has
 * completed. New Guide -> fullscreen handoffs wait here so an old fullscreen
 * release can never overlap the next preview/fullscreen decoder generation.
 */
export function waitForFullscreenRelease(): Promise<void> {
  return roleStopPromises.fullscreen ?? Promise.resolve();
}

export function stopSession(
  role: SessionRole,
  reason: SessionFailReason = "user-stop",
): Promise<void> {
  const existing = roleStopPromises[role];
  if (existing) return existing;

  const state = roles[role];
  const callbacks = invokeStops(role);
  state.generation += 1;
  const stoppedGeneration = state.generation;
  const reservationRevisionAtStop = fullscreenReservationRevision;
  state.phase = "idle";
  state.reason = reason;
  publishOwnership();

  let stopPromise: Promise<void>;
  // Keep teardown ordered. A legacy session callback may still release view
  // state, so let it settle before the single native coordinator performs the
  // decoder release. Starting both operations together reintroduced the exact
  // Preview/fullscreen ownership race this registry exists to prevent.
  stopPromise = callbacks
    .catch(() => undefined)
    .then(() => state.generation === stoppedGeneration ? invokeNative(nativeReleaseHandler, role) : undefined)
    .catch(() => undefined)
    .then(() => {
      if (roleStopPromises[role] === stopPromise) roleStopPromises[role] = null;
      // A later fullscreen reservation must never be cleared by completion of an
      // older teardown. This is the race that allowed a stale fullscreen stop to
      // collide with a newly mounted Guide preview/decoder.
      if (
        role === "fullscreen" &&
        state.generation === stoppedGeneration &&
        fullscreenReservationRevision === reservationRevisionAtStop
      ) {
        fullscreenReserved = false;
      }
      publishOwnership();
    });
  roleStopPromises[role] = stopPromise;
  return stopPromise;
}

export function pauseSessionDecoders(role: SessionRole): Promise<void> {
  if (role === "fullscreen") return invokeNative(nativePauseHandler, role);
  return invokeStops(role);
}

export function stopPreviewSession(reason: SessionFailReason = "superseded"): Promise<void> {
  return stopSession("preview", reason);
}

export function stopPreviewForFullscreen(): Promise<void> {
  reserveFullscreen();
  publishOwnership();
  return stopPreviewSession("superseded");
}

export function stopFullscreenSession(reason: SessionFailReason = "user-stop"): Promise<void> {
  return stopSession("fullscreen", reason);
}

export async function stopAllPlaybackSessions(reason: SessionFailReason = "user-stop"): Promise<void> {
  // Preview and fullscreen share one native decoder owner. Releasing them in
  // parallel can make two callers query/stop that owner at the same time.
  await stopPreviewSession(reason);
  await stopFullscreenSession(reason);
}

export function forceStopAllStreams(): void {
  void stopAllPlaybackSessions("user-stop");
}

export function resetPlaybackSessionsForTests(): void {
  for (const role of Object.keys(roles) as SessionRole[]) {
    roles[role].stops.clear();
    roles[role].generation = 0;
    roles[role].phase = "idle";
    roles[role].reason = null;
    roleStopPromises[role] = null;
  }
  fullscreenReserved = false;
  fullscreenReservationRevision = 0;
  nativeReleaseHandler = null;
  nativePauseHandler = null;
  publishOwnership();
}
