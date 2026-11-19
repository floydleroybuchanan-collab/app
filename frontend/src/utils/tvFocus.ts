import { findNodeHandle, Platform, UIManager } from "react-native";

/**
 * Request native TV focus on a React node (Pressable ref, View ref, etc.).
 *
 * On an actual TV build (Platform.isTV true), the installed TV ViewManager
 * command is authoritative - React's generic HostComponent.focus() calls
 * TextInputState, which is a no-op for a Pressable, so it is never tried there.
 *
 * This app ships one APK for both phone and TV screens, chosen at runtime
 * (player.tsx's own `isTV`/`phoneUi`), but app.json's native TV build flag
 * ("isTV") is false for the whole build - so react-native-tvos's global
 * `Platform.isTV` is false everywhere, on a TV screen layout and a phone
 * layout alike, and the branch above never actually runs on this app. Every
 * call used to fall straight through to the generic (no-op) `.focus()`,
 * which is exactly why a newly-opened overlay here (e.g. the player's
 * aspect-ratio picker) left nothing focused in it. So off an actual TV
 * build, also try the TV ViewManager command first - it can still work on
 * this device even though the build wasn't flagged as TV - before falling
 * back to `.focus()`; a failed attempt is always just a no-op.
 */
export function requestNativeFocus(node: unknown): boolean {
  if (!node) return false;
  if (Platform.isTV) {
    try {
      const handle = findNodeHandle(node as any);
      if (!handle) return false;
      UIManager.dispatchViewManagerCommand(handle, "requestTVFocus" as any, []);
      return true;
    } catch { return false; }
  }
  let invoked = false;
  try {
    const handle = findNodeHandle(node as any);
    if (handle) {
      UIManager.dispatchViewManagerCommand(handle, "requestTVFocus" as any, []);
      invoked = true;
    }
  } catch { /* command unavailable on this build/device - fall through */ }
  const focus = (node as { focus?: () => void }).focus;
  if (typeof focus === "function") {
    try {
      focus.call(node);
      invoked = true;
    } catch { /* also a no-op on some host components - fine, we tried the other path too */ }
  }
  return invoked;
}

/**
 * Retry focus a few times — virtualized lists often mount cells after the first
 * frame. When confirmation is supplied, invoking `.focus()` is not considered
 * success: only the target's real native onFocus ownership stops retries.
 */
export function requestNativeFocusWithRetry(
  node: unknown,
  delaysMs = [0, 32, 96, 200],
  isConfirmed?: () => boolean,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let completed = false;
  const cancel = () => {
    completed = true;
    for (const timer of timers) clearTimeout(timer);
  };
  delaysMs.forEach((delay) => {
    timers.push(
      setTimeout(() => {
        if (completed) return;
        if (isConfirmed?.()) {
          cancel();
          return;
        }
        const invoked = requestNativeFocus(typeof node === "function" ? node() : node);
        // Legacy call sites have no onFocus confirmation callback, so preserve
        // their one-shot behavior. Route-entry owners keep retrying until their
        // actual onFocus handler confirms ownership or cancels on route blur.
        if (!isConfirmed && invoked) cancel();
      }, delay),
    );
  });
  return cancel;
}
