import React from "react";

/**
 * Kept so every page that mounts it still compiles. The app background (violet sky and the crown) is drawn once,
 * behind every screen, by the shell, so a page must not paint its own opaque background over it.
 */
export function GlassBackdrop() {
  return null;
}
