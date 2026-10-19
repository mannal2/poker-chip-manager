import { it, expect, describe } from 'vitest';
import { fixtureState, apply } from './helpers';
import { returnUncalled, transition } from '../../src/game/transition';
import { buildPots, previewSettlement } from '../../src/game/settlement';
import type { GameState, Pot } from '../../src/game/types';
import rawPots from '../../../shared/game-fixtures/pots.json';
const pots = rawPots as Array<{
  id: string;
  H: number[];
  B?: number[];
  folded: number[];
  returnAmount: number;
  amounts: number[];
  eligible: string[][];
}>;
import settlements from '../../../shared/game-fixtures/settlement.json';
function potState(f: (typeof pots)[number]): GameState {
  const s = fixtureState(f.H.length);
  s.players.forEach((p, i) => {
    p.H = f.H[i];
    p.B = f.B?.[i] ?? p.H;
    p.stack = 1000 - p.H;
    p.folded = f.folded.includes(i);
  });
  s.pot = f.H.reduce((a, b) => a + b, 0);
  s.hand!.phase = 'settlement';
  s.hand!.actorId = null;
  returnUncalled(s);
  return s;
}
describe('팟 P01~P07', () => {
  for (const f of pots)
    it(f.id, () => {
      const s = potState(f);
      expect(s.pot).toBe(f.H.reduce((a, b) => a + b, 0) - f.returnAmount);
      const p = buildPots(s);
      expect(p.map((x) => x.amount)).toEqual(f.amounts);
      expect(p.map((x) => x.eligible)).toEqual(f.eligible);
    });
});
describe('승자 W01~W10', () => {
  for (const f of settlements)
    it(f.id, () => {
      const s =
        f.source === 'custom' ? fixtureState() : potState(pots.find((p) => p.id === f.source)!);
      const p: Pot[] =
        f.source === 'custom'
          ? f.amounts!.map((amount, i) => ({ id: `pot${i}`, amount, eligible: f.eligible![i] }))
          : buildPots(s);
      const w = Object.fromEntries(p.map((pot, i) => [pot.id, f.winners[i]]));
      const r = previewSettlement(s, w, p);
      expect(r.ok).toBe(f.ok);
      if (f.payouts) expect(r.payouts).toEqual(f.payouts);
    });
});
it('직전 행동만 취소, 예약 보존, 공개 이후 거절', () => {
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
it('마지막 폴드는 반환과 지급 후 다음 핸드, 취소 불가', () => {
  let s = fixtureState(2);
  s = apply(s, { type: 'FOLD' });
  expect(s.hand?.number).toBe(2);
  expect(s.undo).toBeNull();
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
  const s = potState({
    id: 'fold-blind',
    H: [10, 5, 10],
    folded: [1],
    returnAmount: 0,
    amounts: [25],
    eligible: [['p0', 'p2']],
  });
  expect(buildPots(s)).toEqual([{ id: 'pot0', amount: 25, eligible: ['p0', 'p2'] }]);
  expect(previewSettlement(s, { pot0: ['p0'] }).payouts).toEqual({ p0: 25, p1: 0, p2: 0 });
});
it('폴드 금액 경계를 합쳐 동률 잔여칩을 전체 팟에서 한 번만 분배', () => {
  const s = potState({
    id: 'fold-tie',
    H: [5, 10, 15, 20, 20],
    folded: [0, 1, 2],
    returnAmount: 0,
    amounts: [70],
    eligible: [['p3', 'p4']],
  });
  expect(buildPots(s)).toEqual([{ id: 'pot0', amount: 70, eligible: ['p3', 'p4'] }]);
  const r = previewSettlement(s, { pot0: ['p3', 'p4'] });
  expect(r.ok).toBe(true);
  expect(r.payouts.p3).toBe(35);
  expect(r.payouts.p4).toBe(35);
});
