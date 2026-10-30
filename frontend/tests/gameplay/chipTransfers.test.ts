import { it, expect } from 'vitest';
import { fixtureState, apply, ctx } from '../game/helpers';
import { transition } from '../../src/game/transition';
import { historyRows } from '../../src/features/gameplay/model/history';
import type { GameCommand } from '../../src/game/types';
import { chipTransfers } from '../../src/features/local-game/model/localChipTransfers';
import { eventsToTransfers } from '../../src/features/gameplay/model/eventTransfers';
it('실제 납부만 이동하고 체크·취소·새 핸드 블라인드는 생략', () => {
  const s = fixtureState(2);
  expect(chipTransfers(s, { type: 'CALL' })).toEqual([
    { from: 'p0', to: 'pot', amount: 5, delay: 0, kind: 'bet' },
  ]);
  expect(chipTransfers(apply(s, { type: 'CALL' }), { type: 'CHECK' })).toEqual([]);
  expect(chipTransfers(apply(s, { type: 'CALL' }), { type: 'UNDO' })).toEqual([]);
});
it('마지막 폴드는 같은 수령자의 미콜 반환과 지급을 한 번에 표시', () => {
  expect(chipTransfers(fixtureState(2), { type: 'FOLD' })).toEqual([
    { from: 'pot', to: 'p1', amount: 15, delay: 0, kind: 'payout' },
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

it('반환 없는 마지막 폴드는 단일 지급, 일반 폴드는 이동 없음', () => {
  const s = apply(fixtureState(2), { type: 'CALL' });
  expect(chipTransfers(s, { type: 'FOLD' })).toEqual([
    { from: 'pot', to: 'p0', amount: 20, delay: 0, kind: 'payout' },
  ]);
  expect(chipTransfers(fixtureState(3), { type: 'FOLD' })).toEqual([]);
});

it('확정 이벤트만으로도 같은 이동을 만든다 (온라인 서버 이벤트 경로)', () => {
  const event = (type: string, details: object) => ({
    id: type,
    at: '',
    tournamentId: 't',
    hand: 1,
    type,
    details,
  });
  expect(
    eventsToTransfers(
      [
        event('RAISE', { playerId: 'p0', additional: 40 }),
        event('CHECK', { playerId: 'p1' }),
        event('RETURN', { playerId: 'p0', amount: 20 }),
        event('PAYOUT', { payouts: { p0: 30, p1: 0 } }),
      ],
      'RAISE',
    ),
  ).toEqual([
    { from: 'p0', to: 'pot', amount: 40, delay: 0, kind: 'bet' },
    { from: 'pot', to: 'p0', amount: 20, delay: 720, kind: 'return' },
    { from: 'pot', to: 'p0', amount: 30, delay: 1440, kind: 'payout' },
  ]);
  expect(
    eventsToTransfers(
      [event('RETURN', { playerId: 'p1', amount: 10 }), event('PAYOUT', { payouts: { p1: 15 } })],
      'FOLD',
    ),
  ).toEqual([{ from: 'pot', to: 'p1', amount: 25, delay: 0, kind: 'payout' }]);
});

it('빈 SB에서 모두 BB에게 폴드하면 팟 0 정산: 반환 이동만, 기록은 반환과 핸드 종료', () => {
  let s = fixtureState(4);
  for (const command of [
    { type: 'ALL_IN' },
    { type: 'FOLD' },
    { type: 'FOLD' },
    { type: 'CALL' },
    { type: 'SETTLE_HAND', winners: { pot0: ['p3'] } },
    { type: 'FOLD' },
  ] as GameCommand[])
    s = apply(s, command);
  expect(s.hand).toMatchObject({ number: 2, sbSeat: 2, bbSeat: 3, actorId: 'p1' });
  expect(chipTransfers(s, { type: 'FOLD' })).toEqual([
    { from: 'pot', to: 'p3', amount: 10, delay: 0, kind: 'return' },
  ]);
  const r = transition(s, { type: 'FOLD' }, ctx);
  if (!r.ok) throw Error(r.errorCode);
  expect(r.events.find((e) => e.type === 'PAYOUT')?.details).toEqual({
    pot: 0,
    payouts: { p0: 0, p1: 0, p2: 0, p3: 0 },
  });
  expect(historyRows(r.events, r.state.players).map((row) => row.text)).toEqual([
    'HAND 02',
    '프리플랍',
    'B - 폴드',
    'D - 미콜 10칩 반환',
    '핸드 종료',
    'HAND 03',
    '프리플랍',
  ]);
});
