import type { GameCommand, LegalActions } from './types';

export type DraftRejection = 'NOT_ACTOR' | 'BELOW_CALL' | 'RAISE_CLOSED' | 'MIN_RAISE';
export type DraftClassification =
  { ok: true; command: GameCommand } | { ok: false; code: DraftRejection };

/** Turns a drafted additional amount into the betting command the rules will accept. */
export function classifyDraft(
  legal: LegalActions,
  amount: number,
  currentBet: number,
): DraftClassification {
  const actor = legal.actor;
  if (!actor) return { ok: false, code: 'NOT_ACTOR' };
  if (amount <= 0 || (amount < legal.callAdditional && amount !== legal.maxAdditional))
    return { ok: false, code: 'BELOW_CALL' };
  if (amount === legal.callAdditional) return { ok: true, command: { type: 'CALL' } };
  if (amount === legal.maxAdditional)
    // A short all-in that does not exceed the current bet is a call, so it stays open.
    return actor.B + amount > currentBet && !legal.canRaise
      ? { ok: false, code: 'RAISE_CLOSED' }
      : { ok: true, command: { type: 'ALL_IN' } };
  if (!legal.canRaise) return { ok: false, code: 'RAISE_CLOSED' };
  if (amount < legal.minRaiseAdditional) return { ok: false, code: 'MIN_RAISE' };
  return {
    ok: true,
    command: { type: currentBet === 0 ? 'BET' : 'RAISE', additional: amount },
  };
}
