import { useState } from 'react';
import { buildPots, previewSettlement } from '../game/settlement';
import type { GameState, WinnerSelection } from '../game/types';

export function useSettlementSelection(
  state: GameState | null,
  generation: number | undefined,
  busy: boolean,
  notify: (message: string) => void,
) {
  const [draft, setDraft] = useState<{
    key: string;
    winners: WinnerSelection;
    index: number;
  }>({ key: '', winners: {}, index: 0 });
  const key = state?.tournamentId + '/' + state?.hand?.id + '/' + generation;
  const pots =
    state?.status === 'playing' && state.hand?.phase === 'settlement' ? buildPots(state) : [];
  const winners: WinnerSelection = Object.fromEntries(
    pots.map((p) => [
      p.id,
      p.eligible.length === 1
        ? p.eligible
        : draft.key === key
          ? (draft.winners[p.id] ?? [])
          : [],
    ]),
  );
  const potIndex = draft.key === key ? Math.min(draft.index, pots.length - 1) : 0;
  const currentPot = pots[potIndex];
  const preview = state && pots.length ? previewSettlement(state, winners) : null;

  function selectWinner(id: string) {
    if (busy || !currentPot) return notify('저장 완료를 기다려주세요.');
    if (!currentPot.eligible.includes(id)) return notify('이 팟의 승자 자격이 없습니다.');
    if (currentPot.eligible.length === 1) return notify('단독 자격자는 자동 선택됩니다.');
    const selected = winners[currentPot.id];
    setDraft({
      key,
      index: potIndex,
      winners: {
        ...winners,
        [currentPot.id]: selected.includes(id)
          ? selected.filter((p) => p !== id)
          : [...selected, id],
      },
    });
  }

  const navigation =
    pots.length > 1
      ? {
          previous: () =>
            setDraft({ key, winners, index: (potIndex + pots.length - 1) % pots.length }),
          next: () => setDraft({ key, winners, index: (potIndex + 1) % pots.length }),
          index: potIndex + 1,
          count: pots.length,
        }
      : undefined;

  function resetWinners() {
    setDraft({ key: '', winners: {}, index: 0 });
  }

  return { pots, winners, potIndex, currentPot, preview, navigation, selectWinner, resetWinners };
}
