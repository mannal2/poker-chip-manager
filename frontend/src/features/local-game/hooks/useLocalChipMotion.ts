import { useCallback, type RefObject } from 'react';
import type { GameState } from '../../../game/types';
import type { Request } from '../storage/types';
import { useChipMotion } from '../../gameplay/hooks/useChipMotion';
import { chipTransfers } from '../model/localChipTransfers';

export function useLocalChipMotion(screen: RefObject<HTMLElement | null>, scope: string) {
  const { prepare: prepareMoves, play, clear } = useChipMotion(screen, scope);
  const prepare = useCallback(
    (state: GameState, command: Request['command']) => {
      if (command.type === 'UNDO' || command.type === 'NEW_TOURNAMENT') clear();
      if (
        command.type === 'NEW_TOURNAMENT' ||
        document.hidden ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        return null;
      return prepareMoves(chipTransfers(state, command));
    },
    [clear, prepareMoves],
  );
  return { prepare, play, clear };
}
