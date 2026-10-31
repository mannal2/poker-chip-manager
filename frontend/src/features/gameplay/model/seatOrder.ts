// 플레이어를 목표 좌석으로 옮기고, 두 좌석 사이의 짧은 경로에 있는 플레이어들을 빈자리 쪽으로 한 칸씩 이동시킨다
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
// 좌석 사이 빈틈에 놓았을 때 들어갈 목표 좌석을 구한다
export function gapTarget(from: number, after: number, n: number): number {
  const before = (after + 1) % n;
  return (after - from + n) % n <= (from - before + n) % n ? after : before;
}
