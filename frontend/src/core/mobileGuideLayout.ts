export function mobileGuideLayout(width: number, fontScale = 1) {
  const contentWidth = Math.max(1, width - 24);
  const columns = Math.max(1, Math.min(5, Math.floor(contentWidth / 175)));
  return { columns, cardWidth: Math.max(1, (contentWidth - (columns - 1) * 8) / columns), rowHeight: Math.ceil(184 * Math.max(1, fontScale)) + 8 };
}
export function mobileGuideRestoreOffset(saved: { columns: number; rowHeight: number; offset: number }, columns: number, rowHeight: number, selectedIndex: number) {
  return saved.columns === columns && saved.rowHeight === rowHeight ? Math.max(0, saved.offset) : Math.max(0, Math.floor(selectedIndex / columns)) * rowHeight;
}
