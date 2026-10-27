import type { GameState, GameCommand } from '../../../game/types';
import { transition } from '../../../game/transition';
import type { ChipTransfer } from '../../gameplay/model/chipTransfer';
import { eventsToTransfers } from '../../gameplay/model/eventTransfers';

/** Local only: predicts a command's events by running the rules, before storage confirms them. */
export function chipTransfers(state: GameState, command: GameCommand): ChipTransfer[] {
  if (!['CALL', 'BET', 'RAISE', 'ALL_IN', 'FOLD', 'CHECK', 'SETTLE_HAND'].includes(command.type))
    return [];
  const result = transition(state, command, { id: 'visual-preview', at: '' });
  if (!result.ok) return [];
  return eventsToTransfers(result.events, command.type);
}
