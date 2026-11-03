import { useCallback, type RefObject } from 'react';
import type { GameState } from '../../../game/types';
import type { Request } from '../storage/types';
import { canAnimate, useChipMotion } from '../../gameplay/hooks/useChipMotion';
import { chipTransfers } from '../model/localChipTransfers';

// 명령 결과를 미리 예측해 칩 이동 애니메이션을 준비/재생하는 로컬용 훅
export function useLocalChipMotion(screen: RefObject<HTMLElement | null>, scope: string) {
  const { prepare: prepareMoves, play, clear } = useChipMotion(screen, scope);
  const prepare = useCallback(
    (state: GameState, command: Request['command']) => {
      if (command.type === 'UNDO' || command.type === 'NEW_TOURNAMENT') clear();
      // Skip the rules run for the prediction when nothing could be shown anyway.
      if (command.type === 'NEW_TOURNAMENT' || !canAnimate()) return null;
      return prepareMoves(chipTransfers(state, command));
    },
    [clear, prepareMoves],
  );
  return { prepare, play, clear };
}
