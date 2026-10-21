import { it, expect } from 'vitest';
import { fixtureState, apply } from '../game/helpers';
import { chipTransfers } from '../../src/ui/chipTransfers';
it('실제 납부만 이동하고 체크·취소·새 핸드 블라인드는 생략', () => {
  const s = fixtureState(2);
  expect(chipTransfers(s, { type: 'CALL' })).toEqual([
    { from: 'p0', to: 'pot', amount: 5, delay: 0, kind: 'bet' },
  ]);
  expect(chipTransfers(apply(s, { type: 'CALL' }), { type: 'CHECK' })).toEqual([]);
  expect(chipTransfers(apply(s, { type: 'CALL' }), { type: 'UNDO' })).toEqual([]);
});
it('마지막 폴드는 미콜 반환 후 지급, 새 블라인드 이동 없음', () => {
  expect(chipTransfers(fixtureState(2), { type: 'FOLD' })).toEqual([
    { from: 'pot', to: 'p1', amount: 5, delay: 0, kind: 'return' },
    { from: 'pot', to: 'p1', amount: 10, delay: 360, kind: 'payout' },
  ]);
});
it('공동 우승 지급은 모든 수령자에게 동시에', () => {
  const s = apply(apply(fixtureState(2), { type: 'ALL_IN' }), { type: 'CALL' });
  expect(chipTransfers(s, { type: 'SETTLE_HAND', winners: { pot0: ['p0', 'p1'] } })).toEqual([
    { from: 'pot', to: 'p0', amount: 1000, delay: 0, kind: 'payout' },
    { from: 'pot', to: 'p1', amount: 1000, delay: 0, kind: 'payout' },
  ]);
});
it('메인·사이드팟별 수령액을 플레이어별 합계로 이동', () => {
  let s = fixtureState(3);
  s.players.forEach((p, i) => {
    p.stack = [100, 495, 2390][i];
  });
  s = apply(apply(apply(s, { type: 'ALL_IN' }), { type: 'ALL_IN' }), { type: 'CALL' });
  expect(
    chipTransfers(s, { type: 'SETTLE_HAND', winners: { pot0: ['p0'], pot1: ['p1'] } }),
  ).toEqual([
    { from: 'pot', to: 'p0', amount: 300, delay: 0, kind: 'payout' },
    { from: 'pot', to: 'p1', amount: 800, delay: 0, kind: 'payout' },
  ]);
});
