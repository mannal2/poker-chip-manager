import { fixtureState, apply, ctx } from './helpers';
import { it, expect } from 'vitest';
import { transition } from '../../src/game/transition';
import { runFixtureSuite } from './fixtureRunner';

runFixtureSuite('positions');
runFixtureSuite('betting');
it('기본 3인 프리플랍 BB 옵션, 공개 후 B만 초기화', () => {
  let s = fixtureState();
  expect(s.pot).toBe(15);
  s = apply(s, { type: 'CALL' });
  s = apply(s, { type: 'CALL' });
  expect(s.hand?.actorId).toBe('p2');
  s = apply(s, { type: 'CHECK' });
  expect(s.pot).toBe(30);
  expect(s.hand).toMatchObject({ phase: 'betting', street: 1 });
  expect(transition(s, { type: 'UNDO' }, ctx).ok).toBe(true);
  expect(s.players.map((p) => p.H)).toEqual([10, 10, 10]);
  expect(s.players.map((p) => p.B)).toEqual([0, 0, 0]);
  expect(s.hand?.actorId).toBe('p1');
});
