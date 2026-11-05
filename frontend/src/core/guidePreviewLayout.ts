/** Geometry belongs to the available guide surface, after drawers and TV edges. */
export function guidePreviewLayout(availableWidth: number) {
  const width = Math.max(0, Number.isFinite(availableWidth) ? availableWidth : 0);
  // A normal TV keeps a stable preview when drawers move the guide. Only a
  // genuinely narrow surface reduces it, leaving useful programme information.
  const previewWidth = Math.max(0, Math.min(320, width - Math.min(160, width * 0.46)));
  return { previewWidth, previewHeight: previewWidth * 9 / 16, informationWidth: Math.max(0, width - previewWidth) };
}
