import { findNodeHandle, Platform, UIManager } from "react-native";

/** Request native TV focus on a React node (Pressable ref, View ref, etc.). */
export function requestNativeFocus(node: unknown): boolean {
  if (!node) return false;
  // React's generic HostComponent.focus() calls TextInputState, which is a
  // no-op for a Pressable. TV ViewManager owns requestTVFocus instead.
  if (Platform.isTV) {
    try {
      const handle = findNodeHandle(node as any);
      if (!handle) return false;
      UIManager.dispatchViewManagerCommand(handle, "requestTVFocus" as any, []);
      return true;
    } catch { return false; }
  }
  const focus = (node as { focus?: () => void }).focus;
  if (typeof focus === "function") {
    try {
      focus.call(node);
      return true;
    } catch {}
  }
  return false;
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
        const invoked = requestNativeFocus(node);
        // Legacy call sites have no onFocus confirmation callback, so preserve
        // their one-shot behavior. Route-entry owners keep retrying until their
        // actual onFocus handler confirms ownership or cancels on route blur.
        if (!isConfirmed && invoked) cancel();
      }, delay),
    );
  });
  return cancel;
}
