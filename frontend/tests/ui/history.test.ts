import { it, expect } from 'vitest';
import { historyRows } from '../../src/ui/history';
import type { GameEvent } from '../../src/game/types';
const event = (type: string, details: unknown = {}, hand = 1): GameEvent => ({
  id: Math.random().toString(),
  at: '',
  tournamentId: 't',
  hand,
  type,
  details,
});
it('기술 기록 제외·취소 반영·반환과 여러 수령을 시간순으로 표시', () => {
  const es = [
    event('SETUP_UPDATE'),
    event('HAND_START'),
    event('BET', { playerId: 'a', additional: 20 }),
    event('SET_VIEW'),
    event('UNDO'),
    event('CHECK', { playerId: 'a', additional: 0 }),
    event('CALL', { playerId: 'b', additional: 10 }),
    event('RETURN', { playerId: 'b', amount: 5 }),
    event('REVEAL'),
    event('STREET'),
    event('PAYOUT', { payouts: { a: 15, b: 15 } }),
    event('FOLD', { playerId: 'a', additional: 0 }, 2),
  ];
  expect(
    historyRows(es, [
      { id: 'a', name: 'P1' },
      { id: 'b', name: 'P2' },
    ])
      .filter((r) => r.kind === 'action')
      .map((r) => [r.hand, r.text]),
  ).toEqual([
    [1, 'P1 - 체크'],
    [1, 'P2 - 콜 10칩'],
    [1, 'P2 - 미콜 5칩 반환'],
    [1, 'P1 - 15칩 획득'],
    [1, 'P2 - 15칩 획득'],
    [2, 'P1 - 폴드'],
  ]);
});
it('연속 취소와 다른 핸드·50건 경계에서도 취소 대상만 제거', () => {
  const es = Array.from({ length: 51 }, () => event('CHECK', { playerId: 'a' }));
  es.push(
    event('UNDO'),
    event('CHECK', { playerId: 'b' }),
    event('UNDO'),
    event('HAND_START', {}, 2),
    event('BET', { playerId: 'a', additional: 5 }, 2),
  );
  const rows = historyRows(es, [
    { id: 'a', name: 'P1' },
    { id: 'b', name: 'P2' },
  ]);
  expect(rows.filter((r) => r.kind === 'action')).toHaveLength(51);
  expect(rows.at(-1)?.text).toBe('P1 - 베팅 5칩');
});

it('실제 정산의 0칩 패자·탈락자는 수령자로 표시하지 않음', () => {
  expect(
    historyRows(
      [event('PAYOUT', { payouts: { a: 20, b: 0, c: 0 } })],
      [
        { id: 'a', name: 'P1' },
        { id: 'b', name: 'P2' },
        { id: 'c', name: 'P3' },
      ],
    )
      .filter((r) => r.kind === 'action')
      .map((r) => r.text),
  ).toEqual(['P1 - 20칩 획득']);
});

it('핸드·실제 스트리트·쇼다운도 행으로 포함해 전체 역순 가능', () => {
  const es = [
    event('HAND_START'),
    event('CALL', { playerId: 'a', additional: 5 }),
    event('REVEAL', { showdown: false }),
    event('STREET', { street: 1 }),
    event('CHECK', { playerId: 'b' }),
    event('STREET', { street: 2 }),
    event('CHECK', { playerId: 'a' }),
    event('STREET', { street: 3 }),
    event('CHECK', { playerId: 'b' }),
    event('REVEAL', { showdown: true }),
    event('PAYOUT', { payouts: { a: 20, b: 0 } }),
  ];
  const rows = historyRows(es, [
    { id: 'a', name: 'P1' },
    { id: 'b', name: 'P2' },
  ]);
  expect(rows.map((r) => r.text)).toEqual([
    'HAND 01',
    '프리플랍',
    'P1 - 콜 5칩',
    '플랍',
    'P2 - 체크',
    '턴',
    'P1 - 체크',
    '리버',
    'P2 - 체크',
    '쇼다운',
    'P1 - 20칩 획득',
  ]);
  expect([...rows].reverse().at(-1)?.text).toBe('HAND 01');
});
it('폴드 종료는 쇼다운을 만들지 않고 올인 조기 정산은 가짜 스트리트 없음', () => {
  const players = [{ id: 'a', name: 'P1' }];
  const fold = historyRows(
    [
      event('HAND_START'),
      event('FOLD', { playerId: 'a' }),
      event('RETURN', { playerId: 'a', amount: 5 }),
      event('PAYOUT', { payouts: { a: 10 } }),
    ],
    players,
  ).map((r) => r.text);
  expect(fold).toContain('핸드 종료');
  expect(fold).not.toContain('쇼다운');
  const allin = historyRows(
    [
      event('HAND_START'),
      event('ALL_IN', { playerId: 'a', additional: 95 }),
      event('REVEAL', { showdown: true }),
      event('PAYOUT', { payouts: { a: 200 } }),
    ],
    players,
  ).map((r) => r.text);
  expect(allin).toContain('쇼다운');
  expect(allin).not.toContain('플랍');
  expect(allin).not.toContain('턴');
  expect(allin).not.toContain('리버');
});
