import { describe, it, expect } from 'vitest';
import { moveCircularSeat, gapTarget } from '../../src/ui/seatOrder';
describe('원형 삽입', () => {
  it('처음/끝은 인접: 나머지 카드는 고정', () => {
    expect(moveCircularSeat(['a', 'b', 'c', 'd', 'e', 'f'], 'a', 5)).toEqual([
      'f',
      'b',
      'c',
      'd',
      'e',
      'a',
    ]);
    expect(gapTarget(0, 4, 6)).toBe(5);
    expect(gapTarget(0, 5, 6)).toBe(0);
  });
  it('2~10인 모든 출발·도착·화면 기준: 최단 구간만 이동, 다른 순서 보존', () => {
    for (let n = 2; n <= 10; n++)
      for (let view = 0; view < n; view++)
        for (let from = 0; from < n; from++)
          for (let to = 0; to < n; to++) {
            const ids = Array.from({ length: n }, (_, i) => String(i)),
              id = ids[from];
            const next = moveCircularSeat(ids, id, to),
              cw = (to - from + n) % n,
              ccw = (from - to + n) % n;
            expect(next[to]).toBe(id);
            expect(new Set(next).size).toBe(n);
            const shifted = ids.filter((_, i) => next[i] !== ids[i]).length;
            expect(shifted).toBe(from === to ? 0 : Math.min(cw, ccw) + 1);
            const screenIds = [...ids.slice(view), ...ids.slice(0, view)];
            const screenNext = moveCircularSeat(screenIds, id, (to - view + n) % n);
            expect(screenNext).toEqual([...next.slice(view), ...next.slice(0, view)]);
          }
  });
});

it('2~10인 모든 틈에 삽입하면 지정한 두 참가자 사이에 위치', () => {
  for (let n = 2; n <= 10; n++)
    for (let from = 0; from < n; from++)
      for (let after = 0; after < n; after++) {
        const ids = Array.from({ length: n }, (_, i) => String(i)),
          id = ids[from];
        const next = moveCircularSeat(ids, id, gapTarget(from, after, n));
        if (after === from || (after + 1) % n === from) expect(next).toEqual(ids);
        else {
          const slot = next.indexOf(id);
          expect(next[(slot + n - 1) % n]).toBe(ids[after]);
          expect(next[(slot + 1) % n]).toBe(ids[(after + 1) % n]);
        }
      }
});
