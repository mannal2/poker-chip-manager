import { useState } from 'react';
import { getLegalActions } from '../game/transition';
import type { GameCommand, GameState } from '../game/types';

export function useBettingDraft(
  state: GameState | null,
  generation: number | undefined,
  notify: (message: string) => void,
) {
  const [draft, setDraft] = useState({ scope: '', version: -1, amount: 0 });
  const scope = state?.tournamentId + ':' + generation;
  const legal = state ? getLegalActions(state) : null;
  const draftAmount =
    state && generation !== undefined && draft.scope === scope && draft.version === state.version
      ? draft.amount
      : 0;
  const submitAllowed =
    !!legal?.actor &&
    draftAmount > 0 &&
    (draftAmount === legal.callAdditional ||
      (draftAmount === legal.maxAdditional &&
        (legal.actor.B + draftAmount <= state!.hand!.W || legal.canRaise)) ||
      (legal.canRaise && draftAmount >= legal.minRaiseAdditional));

  function prepareAction(action: string, amount = 0): GameCommand | undefined {
    if (!state || !legal?.actor) {
      notify('지금은 베팅 차례가 아닙니다.');
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
    let command: GameCommand = { type: action as GameCommand['type'] };
    if (action === 'SUBMIT') {
      if (
        draftAmount <= 0 ||
        (draftAmount < legal.callAdditional && draftAmount !== legal.maxAdditional)
      ) {
        notify('콜 금액 이상으로 칩을 선택하세요.');
        return;
      }
      if (draftAmount === legal.callAdditional) command = { type: 'CALL' };
      else if (draftAmount === legal.maxAdditional) {
        if (legal.actor.B + draftAmount > state.hand!.W && !legal.canRaise) {
          notify(legal.reason);
          return;
        }
        command = { type: 'ALL_IN' };
      } else {
        if (!legal.canRaise) {
          notify(legal.reason);
          return;
        }
        if (draftAmount < legal.minRaiseAdditional) {
          notify(
            '최소 추가 레이즈는 ' + legal.minRaiseAdditional.toLocaleString('ko-KR') + '칩입니다.',
          );
          return;
        }
        command = { type: state.hand!.W === 0 ? 'BET' : 'RAISE', additional: draftAmount };
      }
    }
    return command;
  }

  return { legal, draftAmount, submitAllowed, prepareAction };
}
