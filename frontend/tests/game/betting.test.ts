import { fixtureState, apply, ctx } from './helpers';
import { describe, it, expect } from 'vitest';
import { transition, getLegalActions } from '../../src/game/transition';
import { nextPositions } from '../../src/game/positions';
import { assertInvariants } from '../../src/game/invariants';
import type { GameCommand } from '../../src/game/types';
import positions from '../../../shared/game-fixtures/positions.json';
import rawBetting from '../../../shared/game-fixtures/betting.json';
const betting = rawBetting as Array<{
  id: string;
  initialState: {
    stacks: number[];
    street?: number;
    W?: number;
    R?: number;
    bb?: number;
    actor?: number;
    B?: number[];
    H?: number[];
    folded?: number[];
    acted?: Array<number | null>;
  };
  commands: GameCommand[];
  expectedError?: string;
  expectedStateSubset?: unknown;
  expectedLegal?: unknown;
}>;
describe('위치 D01~D12', () => {
  for (const f of positions)
    it(f.id, () => {
      let p = f.initialState;
      for (const step of f.commands) {
        p = nextPositions(step.alive, p);
        expect(p).toEqual(step.expected);
      }
    });
});
describe('베팅 B01~B23', () => {
  for (const f of betting)
    it(f.id, () => {
      let s = fixtureState(f.initialState.stacks.length);
      s.hand = {
        ...s.hand!,
        street: f.initialState.street ?? 1,
        W: f.initialState.W ?? 0,
        R: f.initialState.R ?? 100,
        bb: f.initialState.bb ?? 100,
        actorId: `p${f.initialState.actor ?? 0}`,
        pending: s.players.map((p) => p.id),
      };
      s.players.forEach((p, i) => {
        p.stack = f.initialState.stacks[i];
        p.B = f.initialState.B?.[i] ?? 0;
        p.H = f.initialState.H?.[i] ?? p.B;
        p.folded = f.initialState.folded?.includes(i) ?? false;
        p.actedAt = f.initialState.acted?.[i] ?? null;
        p.reopenAt = p.actedAt === null ? 0 : p.actedAt + s.hand!.R;
      });
      s.pot = s.players.reduce((n, p) => n + p.H, 0);
      s.initialTotal = s.pot + s.players.reduce((n, p) => n + p.stack, 0);
      for (const command of f.commands) {
        const before = JSON.stringify(s);
        const r = transition(s, command as GameCommand, ctx);
        expect(JSON.stringify(s)).toBe(before);
        if (f.expectedError) {
          if (r.ok) throw Error('거절되어야 하는 명령입니다.');
          expect(r.errorCode).toBe(f.expectedError);
          return;
        }
        if (!r.ok) throw Error(r.errorCode);
        s = r.state;
        assertInvariants(s);
      }
      if (f.expectedStateSubset) expect(s).toMatchObject(f.expectedStateSubset);
      if (f.expectedLegal) expect(getLegalActions(s)).toMatchObject(f.expectedLegal);
    });
});
it('기본 3인 프리플랍 BB 옵션, 공개 후 B만 초기화', () => {
  let s = fixtureState();
  expect(s.pot).toBe(15);
  s = apply(s, { type: 'CALL' });
  s = apply(s, { type: 'CALL' });
  expect(s.hand?.actorId).toBe('p2');
  s = apply(s, { type: 'CHECK' });
  expect(s.pot).toBe(30);
  expect(s.hand).toMatchObject({ phase: 'betting', street: 1 });
  expect(transition(s, { type: 'UNDO' }, ctx).ok).toBe(false);
  expect(s.players.map((p) => p.H)).toEqual([10, 10, 10]);
  expect(s.players.map((p) => p.B)).toEqual([0, 0, 0]);
  expect(s.hand?.actorId).toBe('p1');
});
