/** Visual positions are separate from decoder slots: moving a tile never restarts playback. */
export function multiviewLayout(slots: number[], enlarged: number | null) {
  return Object.fromEntries(slots.map((slot, index) => {
    if (enlarged != null) return [slot, { left: enlarged === slot ? 0 : -200, top: 0, width: 100, height: 100 }];
    const n = slots.length;
    if (n === 1) return [slot, { left: 0, top: 0, width: 100, height: 100 }];
    if (n === 2) return [slot, { left: index * 50, top: 0, width: 50, height: 100 }];
    if (n === 3) return [slot, index === 0 ? { left: 0, top: 0, width: 66.6667, height: 100 }
      : { left: 66.6667, top: (index - 1) * 50, width: 33.3333, height: 50 }];
    return [slot, { left: (index % 2) * 50, top: Math.floor(index / 2) * 50, width: 50, height: 50 }];
  }));
}
