// Shift only the shorter arc into the vacancy left by the dragged card.
export function moveCircularSeat(ids: string[], id: string, target: number): string[] {
  const next = [...ids],
    n = ids.length,
    from = ids.indexOf(id);
  const direction = (target - from + n) % n <= (from - target + n) % n ? 1 : -1;
  for (let slot = from; slot !== target;) {
    const adjacent = (slot + direction + n) % n;
    next[slot] = ids[adjacent];
    slot = adjacent;
  }
  next[target] = id;
  return next;
}
export function gapTarget(from: number, after: number, n: number): number {
  const before = (after + 1) % n;
  return (after - from + n) % n <= (from - before + n) % n ? after : before;
}
