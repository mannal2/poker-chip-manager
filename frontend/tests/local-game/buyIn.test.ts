import { expect, it } from 'vitest';
import { buyInBlockReason, seatOptions } from '../../src/features/local-game/model/buyIn';
import { fixtureState } from '../game/helpers';
import type { GameState } from '../../src/game/types';

// 한 명을 탈락시킨 진행 중 상태를 만든다
function withEliminated(s: GameState, id: string): GameState {
  const copy = structuredClone(s);
  copy.players.find((p) => p.id === id)!.eliminated = true;
  return copy;
}

// 좌석마다 사이 항목이, 탈락자마다 빈자리 항목이 자리 순서로 나온다
it('lists between and empty-seat options in seat order', () => {
  const s = withEliminated(fixtureState(3), 'p1');
  const options = seatOptions(s);
  expect(options.map((o) => o.label)).toEqual([
    'A와 B 사이',
    'B의 빈자리',
    'B와 C 사이',
    'C와 A 사이',
  ]);
  expect(options[1].placement).toEqual({ kind: 'replace', playerId: 'p1' });
  expect(options[0].placement).toEqual({ kind: 'between', after: 'p0' });
  expect(new Set(options.map((o) => o.key)).size).toBe(4);
});

// 열 자리가 가득 차면 사이 항목을 만들지 않는다
it('has no between options at ten seats', () => {
  const s = withEliminated(fixtureState(10), 'p4');
  expect(seatOptions(s).map((o) => o.label)).toEqual(['E의 빈자리']);
});

// 막힌 사유를 상태별로 알려 준다
it('explains why buy-in is blocked', () => {
  const s = fixtureState(3);
  expect(buyInBlockReason(s)).toBeNull();
  expect(buyInBlockReason({ ...s, status: 'ended' })).toBe(
    '진행 중인 토너먼트에서만 바이인할 수 있습니다.',
  );
  expect(buyInBlockReason(fixtureState(10))).toBe('빈자리가 없어 바이인할 수 없습니다.');
});
