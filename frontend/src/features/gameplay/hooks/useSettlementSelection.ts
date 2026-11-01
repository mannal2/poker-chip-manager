import { useState } from 'react';
import { buildPots, previewSettlement } from '../../../game/settlement';
import type { GameState, WinnerSelection } from '../../../game/types';
import type { GameSession } from '../session';

// 팟별 승자 선택과 정산 미리보기를 관리하는 훅
/** Change scope for a new tournament, hand or input session, excluding version-only updates. */
export function useSettlementSelection(
  state: GameState | null,
  scope: string,
  busy: boolean,
  notify: (message: string) => void,
  sharedSelection?: GameSession['sharedSelection'],
  onSelectionChange?: GameSession['onSelectionChange'],
) {
  const [draft, setDraft] = useState<{
    key: string;
    winners: WinnerSelection;
    index: number;
  }>({ key: '', winners: {}, index: 0 });
  const pots =
    state?.status === 'playing' && state.hand?.phase === 'settlement' ? buildPots(state) : [];
  const winners: WinnerSelection = sharedSelection
    ? Object.fromEntries(pots.map((p) => [p.id, sharedSelection.winners[p.id] ?? []]))
    : Object.fromEntries(
        pots.map((p) => [
          p.id,
          p.eligible.length === 1
            ? p.eligible
            : draft.key === scope
              ? (draft.winners[p.id] ?? [])
              : [],
        ]),
      );
  const potIndex = sharedSelection
    ? sharedSelection.potIndex
    : draft.key === scope
      ? Math.min(draft.index, pots.length - 1)
      : 0;
  const currentPot = pots[potIndex];
  const preview = state && pots.length ? previewSettlement(state, winners) : null;

  // 외부 선택이 있으면 변경 요청만 전달하고 로컬에서는 초안을 저장한다.
  function changeSelection(winners: WinnerSelection, index: number) {
    if (sharedSelection) {
      if (!busy) onSelectionChange?.({ winners, potIndex: index });
    } else setDraft({ key: scope, winners, index });
  }

  // 현재 팟에서 해당 플레이어가 선택되어 있으면 해제하고, 선택되어 있지 않으면 승자로 선택한다
  function selectWinner(id: string) {
    if (busy || !currentPot) return notify('저장 완료를 기다려주세요.');
    if (!currentPot.eligible.includes(id)) return notify('이 팟의 승자 자격이 없습니다.');
    if (currentPot.eligible.length === 1) return notify('단독 자격자는 자동 선택됩니다.');
    const selected = winners[currentPot.id];
    changeSelection(
      {
        ...winners,
        [currentPot.id]: selected.includes(id)
          ? selected.filter((p) => p !== id)
          : [...selected, id],
      },
      potIndex,
    );
  }

  const navigation =
    pots.length > 1
      ? {
          previous: () => changeSelection(winners, (potIndex + pots.length - 1) % pots.length),
          next: () => changeSelection(winners, (potIndex + 1) % pots.length),
          index: potIndex + 1,
          count: pots.length,
        }
      : undefined;

  // 승자 선택을 모두 초기화한다
  function resetWinners() {
    setDraft({ key: '', winners: {}, index: 0 });
  }

  return { pots, winners, potIndex, currentPot, preview, navigation, selectWinner, resetWinners };
}
