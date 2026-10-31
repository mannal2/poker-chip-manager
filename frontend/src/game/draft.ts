import type { DraftRejection } from './errors';
import type { GameCommand, LegalActions } from './types';

// 임시 베팅 금액을 분류한 결과(실행할 명령 또는 거절 사유)
export type DraftClassification =
  { ok: true; command: GameCommand } | { ok: false; code: DraftRejection };

// 입력한 추가 금액을 콜/올인/벳/레이즈 명령으로 바꾸거나 거절 사유를 돌려준다
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
