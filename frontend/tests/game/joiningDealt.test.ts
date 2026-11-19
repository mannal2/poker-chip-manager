import { describe, it, expect } from 'vitest';
import { createTournament, transition } from '../../src/game/transition';
import { isBetweenButtonAndSb } from '../../src/game/positions';
import type { GameCommand, GameState } from '../../src/game/types';

const ctx = { id: 'T', at: '2026-11-19T00:00:00Z' };
// 명령을 차례로 실행해 마지막 상태를 돌려준다
function run(names: string[], commands: object[]): GameState {
  let s = createTournament({ names, initial: 1000, sb: 5, bb: 10, button: 0 }, ctx);
  for (const c of commands) {
    const r = transition(s, c as GameCommand, ctx);
    if (!r.ok) throw Error(r.errorCode);
    s = r.state;
  }
  return s;
}
const buyIn = (after: string) => ({
  type: 'BUY_IN',
  name: 'Dan',
  placement: { kind: 'between', after },
});

describe('대기자 참여', () => {
  it('다음 핸드에 참여하면 joining과 replaced가 지워진다', () => {
    const s = run(['A', 'B'], [{ type: 'START_TOURNAMENT' }, buyIn('p1'), { type: 'FOLD' }]);
    expect(s.players[2]).not.toHaveProperty('joining');
    expect(s.players[2]).not.toHaveProperty('replaced');
  });
  it('버튼과 SB 사이에서 기다리는 사람은 joining이 button이다', () => {
    const s = run(
      ['A', 'B', 'C', 'D'],
      [{ type: 'START_TOURNAMENT' }, buyIn('p1'), ...[1, 2, 3].map(() => ({ type: 'FOLD' }))],
    );
    expect(s.players[2].joining).toBe('button');
  });
  it('isBetweenButtonAndSb는 양 끝과 헤즈업을 제외한다', () => {
    expect(isBetweenButtonAndSb(2, 1, 3, 5)).toBe(true);
    expect(isBetweenButtonAndSb(1, 1, 3, 5)).toBe(false);
    expect(isBetweenButtonAndSb(3, 1, 3, 5)).toBe(false);
    expect(isBetweenButtonAndSb(0, 4, 1, 5)).toBe(true);
    expect(isBetweenButtonAndSb(2, 0, 0, 5)).toBe(false);
  });
});
