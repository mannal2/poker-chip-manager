import { useState } from 'react';
import { classifyDraft } from '../../../game/betting';
import { messageFor } from '../model/errorMessages';
import type { BetAction } from '../components/BetControls';
import type { GameCommand, GameState, LegalActions } from '../../../game/types';

/** Change scope for a new tournament or input session; undefined disables the draft. */
export function useBettingDraft(
  state: GameState | null,
  legal: LegalActions | null,
  scope: string | undefined,
  notify: (message: string) => void,
) {
  const [draft, setDraft] = useState({ scope, version: -1, amount: 0 });
  const draftAmount =
    state && scope !== undefined && draft.scope === scope && draft.version === state.version
      ? draft.amount
      : 0;
  const currentBet = state?.hand?.W ?? 0;
  const submitAllowed = !!legal && classifyDraft(legal, draftAmount, currentBet).ok;

  function prepareAction(action: BetAction, amount = 0): GameCommand | undefined {
    if (!state || !legal?.actor) {
      notify(messageFor('NOT_ACTOR'));
      return;
    }
    if (action === 'FOLD' && legal.callAdditional === 0) return;
    if (action === 'CLEAR') {
      setDraft({ scope, version: state.version, amount: 0 });
      return;
    }
    if (action === 'CHIP') {
      if (draftAmount + amount > legal.maxAdditional) {
        notify('남은 칩을 초과할 수 없습니다.');
        return;
      }
      setDraft({ scope, version: state.version, amount: draftAmount + amount });
      return;
    }
    if (action === 'DRAFT_ALL') {
      setDraft({ scope, version: state.version, amount: legal.maxAdditional });
      return;
    }
    if (action !== 'SUBMIT') return { type: action };
    const result = classifyDraft(legal, draftAmount, currentBet);
    if (result.ok) return result.command;
    if (result.code === 'MIN_RAISE')
      notify(
        '최소 추가 레이즈는 ' + legal.minRaiseAdditional.toLocaleString('ko-KR') + '칩입니다.',
      );
    // RAISE_CLOSED is explained by why the actor cannot raise (closed action or no opponent).
    else if (result.code === 'RAISE_CLOSED') notify(messageFor(legal.reasonCode ?? 'RAISE_CLOSED'));
    else notify(messageFor(result.code));
  }

  return { draftAmount, submitAllowed, prepareAction };
}
