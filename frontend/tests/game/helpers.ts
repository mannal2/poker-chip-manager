import { expect } from 'vitest';
import { createTournament, transition, returnUncalled } from '../../src/game/transition';
import { assertInvariants } from '../../src/game/invariants';
import type { GameState, GameCommand } from '../../src/game/types';
export const ctx = { id: 'test', at: '2026-10-18T00:00:00Z' };
export function fixtureState(n = 3): GameState {
  const s = createTournament(
    {
      names: Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)),
      initial: 1000,
      sb: 5,
      bb: 10,
      button: 0,
    },
    ctx,
  );
  const r = transition(s, { type: 'START_TOURNAMENT' }, ctx);
  if (!r.ok) throw Error(r.errorCode);
  return r.state;
}
export function apply(s: GameState, c: GameCommand): GameState {
  const before = JSON.stringify(s);
  const r = transition(s, c, ctx);
  expect(JSON.stringify(s)).toBe(before);
  if (!r.ok) throw Error(r.errorCode);
  assertInvariants(r.state);
  return r.state;
}

// Settlement-phase state where player i committed H[i] chips (used by hand-written unit tests).
export function heightsState(H: number[], folded: number[]): GameState {
  const s = fixtureState(H.length);
  s.players.forEach((p, i) => {
    p.H = H[i];
    p.B = H[i];
    p.stack = 1000 - H[i];
    p.folded = folded.includes(i);
  });
  s.pot = H.reduce((a, b) => a + b, 0);
  s.hand!.phase = 'settlement';
  s.hand!.actorId = null;
  returnUncalled(s);
  return s;
}
