import { it, expect } from 'vitest';
import { fixtureState, apply, heightsState } from './helpers';
import { transition } from '../../src/game/transition';
import { buildPots, previewSettlement } from '../../src/game/settlement';
import type { GameState } from '../../src/game/types';
import { runFixtureSuite } from './fixtureRunner';

runFixtureSuite('pots');
runFixtureSuite('settlement');
it('직전 행동만 취소, 예약 보존, 한 번 사용 후 거절', () => {
  let s = fixtureState();
  s = apply(s, { type: 'CALL' });
  s = apply(s, { type: 'SCHEDULE_BLINDS', sb: 10, bb: 20 });
  s = apply(s, { type: 'UNDO' });
  expect(s.pot).toBe(15);
  expect(s.pendingBlinds).toEqual({ sb: 10, bb: 20 });
  expect(transition(s, { type: 'UNDO' }, { id: 'x', at: 't' }).ok).toBe(false);
  s = apply(s, { type: 'CALL' });
  expect(s.pot).toBe(25);
});
it('정산과 다음 핸드 블라인드 1회, 총량 6000', () => {
  let s = fixtureState(6);
  while (s.hand!.phase === 'betting') s = apply(s, { type: getCall(s) });
  const w = Object.fromEntries(buildPots(s).map((p) => [p.id, ['p0']]));
  s = apply(s, { type: 'SETTLE_HAND', winners: w });
  expect(s.hand?.number).toBe(2);
  expect(s.pot).toBe(15);
  expect(s.players.reduce((n, p) => n + p.stack, 0)).toBe(5985);
  expect(s.players.map((p) => p.H)).toEqual([0, 0, 5, 10, 0, 0]);
});
function getCall(s: GameState): 'CALL' | 'CHECK' {
  const p = s.players.find((p) => p.id === s.hand!.actorId)!;
  return p.B < s.hand!.W ? 'CALL' : 'CHECK';
}
it('최종 올인 우승은 다음 핸드 없음, 중단은 장부 보존', () => {
  let s = fixtureState(2);
  s = apply(s, { type: 'ALL_IN' });
  s = apply(s, { type: 'CALL' });
  s = apply(s, {
    type: 'SETTLE_HAND',
    winners: Object.fromEntries(buildPots(s).map((p) => [p.id, ['p0']])),
  });
  expect(s.status).toBe('ended');
  expect(s.hand?.number).toBe(1);
  expect(s.pot).toBe(0);
  expect(s.players[0].stack).toBe(2000);
  let a = fixtureState();
  a = apply(a, { type: 'ABORT' });
  expect(a.status).toBe('aborted');
  expect(a.pot).toBe(15);
  expect(transition(a, { type: 'CALL' }, { id: 'x', at: 't' }).ok).toBe(false);
});
it('마지막 폴드는 반환과 지급 후 다음 핸드, 직전 폴드 복원 가능', () => {
  let s = fixtureState(2);
  s = apply(s, { type: 'FOLD' });
  expect(s.hand?.number).toBe(2);
  expect(s.undo).not.toBeNull();
  expect(s.players.map((p) => p.stack)).toEqual([985, 1000]);
});

it('미리보기는 팟별 지급과 잔여 5칩 수령자를 제공한다', () => {
  const s = fixtureState();
  const r = previewSettlement(s, { pot0: ['p1', 'p2'] }, [
    { id: 'pot0', amount: 15, eligible: ['p1', 'p2'] },
  ]);
  expect(r).toMatchObject({
    ok: true,
    allocations: [
      { potId: 'pot0', amount: 15, payouts: { p1: 10, p2: 5 }, remainderRecipients: ['p1'] },
    ],
  });
});

it('올인 없는 SB 폴드의 5/10/10은 같은 자격자의 단일25팟', () => {
  const s = heightsState([10, 5, 10], [1]);
  expect(buildPots(s)).toEqual([{ id: 'pot0', amount: 25, eligible: ['p0', 'p2'] }]);
  expect(previewSettlement(s, { pot0: ['p0'] }).payouts).toEqual({ p0: 25, p1: 0, p2: 0 });
});
it('폴드 금액 경계를 합쳐 동률 잔여칩을 전체 팟에서 한 번만 분배', () => {
  const s = heightsState([5, 10, 15, 20, 20], [0, 1, 2]);
  expect(buildPots(s)).toEqual([{ id: 'pot0', amount: 70, eligible: ['p3', 'p4'] }]);
  const r = previewSettlement(s, { pot0: ['p3', 'p4'] });
  expect(r.ok).toBe(true);
  expect(r.payouts.p3).toBe(35);
  expect(r.payouts.p4).toBe(35);
});
