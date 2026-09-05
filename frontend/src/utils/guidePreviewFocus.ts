import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";

const nodes = new Map<string, unknown>();
let preferredKey = "play";
let focusGeneration = 0;
let cancelPendingFocus: (() => void) | null = null;

export function registerGuidePreviewNode(key: string, node: unknown, preferred = false): void {
  if (node) nodes.set(key, node); else nodes.delete(key);
  if (!nodes.size) { cancelPendingFocus?.(); cancelPendingFocus = null; }
  if (preferred) preferredKey = key;
}

export function noteGuidePreviewFocus(node?: unknown): void {
  if (!node) return;
  focusGeneration += 1;
  cancelPendingFocus?.();
  cancelPendingFocus = null;
}

export function focusGuidePreviewSurface(): boolean {
  const node = nodes.get(preferredKey) || nodes.values().next().value;
  if (!node) return false;
  cancelPendingFocus?.();
  const generation = focusGeneration;
  cancelPendingFocus = requestNativeFocusWithRetry(node, [0, 60, 140, 320, 560], () => focusGeneration !== generation);
  return true;
}
