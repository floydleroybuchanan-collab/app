/**
 * Visual positions are separate from decoder slots: moving a tile never restarts playback.
 *
 * Boxes are percentages of a 16:9 screen, and every box keeps width === height
 * in percent terms, so each tile is itself 16:9 and video is never stretched.
 * Layouts that cannot fill the screen at that shape are centred, leaving black
 * bands, rather than distorting the picture.
 */
export function multiviewLayout(slots: number[], enlarged: number | null) {
  return Object.fromEntries(slots.map((slot, index) => {
    if (enlarged != null) return [slot, { left: enlarged === slot ? 0 : -200, top: 0, width: 100, height: 100 }];
    const n = slots.length;
    if (n === 1) return [slot, { left: 0, top: 0, width: 100, height: 100 }];
    // Two side by side, vertically centred.
    if (n === 2) return [slot, { left: index * 50, top: 25, width: 50, height: 50 }];
    // One main tile with two stacked beside it, vertically centred.
    if (n === 3) return [slot, index === 0 ? { left: 0, top: 16.6667, width: 66.6667, height: 66.6667 }
      : { left: 66.6667, top: 16.6667 + (index - 1) * 33.3333, width: 33.3333, height: 33.3333 }];
    return [slot, { left: (index % 2) * 50, top: Math.floor(index / 2) * 50, width: 50, height: 50 }];
  }));
}
