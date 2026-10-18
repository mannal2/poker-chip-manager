import { it, expect } from 'vitest';
import { fixtureState, apply, ctx } from './helpers';
import { transition, getLegalActions, createTournament } from '../../src/game/transition';
import { buildPots } from '../../src/game/settlement';
import { assertInvariants } from '../../src/game/invariants';
it('명령 Bet/Raise의 의미를 구분한다', () => {
  const s = fixtureState();
  expect(transition(s, { type: 'BET', additional: 20 }, ctx).ok).toBe(false);
  const f = apply(apply(apply(s, { type: 'CALL' }), { type: 'CALL' }), { type: 'CHECK' });
  expect(transition(f, { type: 'RAISE', additional: 20 }, ctx).ok).toBe(false);
});
it('재정렬·인원 축소 후 추가해도 ID 유일성을 보존한다', () => {
  let s = createTournament(
    { names: ['A', 'B', 'C'], initial: 1000, sb: 5, bb: 10, button: 0, viewSeat: 0 },
    ctx,
  );
  s = apply(s, {
    type: 'SETUP_UPDATE',
    settings: { ...s.settings, names: ['C', 'B'], button: 0 },
    order: ['p2', 'p1'],
  });
  s = apply(s, { type: 'SETUP_UPDATE', settings: { ...s.settings, names: ['C', 'B', 'D'] } });
  expect(new Set(s.players.map((p) => p.id)).size).toBe(3);
  expect(s.players.slice(0, 2).map((p) => p.id)).toEqual(['p2', 'p1']);
});
it('반환을 포함한 자동 정산 진입은 undo 잠금과 반환을 보존한다', () => {
  let s = fixtureState(3);
  s.players[0].stack = 100;
  s.players[1].stack = 60;
  s.players[2].stack = 20;
  s.initialTotal = 195;
  s = apply(s, { type: 'ALL_IN' });
  s = apply(s, { type: 'ALL_IN' });
  s = apply(s, { type: 'CALL' });
  expect(s.players[0].H).toBe(65);
  expect(s.hand!.phase).toBe('settlement');
  expect(s.undo).toBeNull();
  expect(transition(s, { type: 'UNDO' }, ctx).ok).toBe(false);
});
for (const amount of [-5, 0, 1.5, 7, 1005])
  it(`잘못된 베팅 ${amount} 입력 불변`, () => {
    const s = fixtureState();
    const before = JSON.stringify(s);
    expect(transition(s, { type: 'RAISE', additional: amount }, ctx).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
it('결정적 2~9인 토너먼트: 모든 성공 전환 보존·불변과 종료', () => {
  let seed = 81;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let n = 2; n <= 9; n++)
    for (let game = 0; game < 8; game++) {
      let s = fixtureState(n);
      let steps = 0;
      while (s.status === 'playing' && steps++ < 3000) {
        const before = JSON.stringify(s);
        let command: import('../../src/game/types').GameCommand;
        const h = s.hand!;
        if (h.phase === 'betting') {
          const l = getLegalActions(s);
          const choice = rand();
          command =
            choice < 0.15
              ? { type: 'FOLD' }
              : choice < 0.6 && l.canRaise
                ? { type: 'ALL_IN' }
                : { type: l.canCall ? 'CALL' : 'CHECK' };
        } else if (h.phase === 'revealPending') command = { type: 'BEGIN_REVEAL' };
        else if (h.phase === 'revealed') command = { type: 'ADVANCE_STREET' };
        else {
          const live = s.players.filter((p) => !p.folded && !p.eliminated).sort(() => 0);
          const rank = [...live].sort((a, b) => a.id.localeCompare(b.id));
          command = {
            type: 'SETTLE_HAND',
            winners: Object.fromEntries(
              buildPots(s).map((p) => [p.id, [rank.find((x) => p.eligible.includes(x.id))!.id]]),
            ),
          };
        }
        const r = transition(s, command, { id: `${n}-${game}-${steps}`, at: 'test' });
        expect(JSON.stringify(s)).toBe(before);
        if (!r.ok) throw Error(r.errorCode);
        s = r.state;
        assertInvariants(s);
      }
      expect(s.status).toBe('ended');
      expect(s.pot).toBe(0);
      expect(s.players.filter((p) => p.stack > 0)).toHaveLength(1);
    }
});
