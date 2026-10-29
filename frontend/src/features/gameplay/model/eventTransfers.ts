import type { GameCommand, GameEvent } from '../../../game/types';
import type { ChipTransfer } from './chipTransfer';

/**
 * Turns confirmed (online) or predicted (local) events into chip flights. Each event group plays
 * 720ms after the previous one; a final fold shows its return and payout as one flight each.
 */
export function eventsToTransfers(
  events: GameEvent[],
  commandType: GameCommand['type'],
): ChipTransfer[] {
  const moves: ChipTransfer[] = [];
  let delay = 0;
  for (const event of events) {
    const d = event.details as {
      playerId?: string;
      additional?: number;
      amount?: number;
      payouts?: Record<string, number>;
    };
    const group: ChipTransfer[] = [];
    if (['CALL', 'BET', 'RAISE', 'ALL_IN'].includes(event.type) && d.additional! > 0)
      group.push({ from: d.playerId!, to: 'pot', amount: d.additional!, delay, kind: 'bet' });
    if (event.type === 'RETURN' && d.amount! > 0)
      group.push({ from: 'pot', to: d.playerId!, amount: d.amount!, delay, kind: 'return' });
    if (event.type === 'PAYOUT')
      for (const [to, amount] of Object.entries(d.payouts!))
        if (amount > 0) group.push({ from: 'pot', to, amount, delay, kind: 'payout' });
    if (group.length) {
      moves.push(...group);
      delay += 720;
    }
  }
  if (commandType === 'FOLD' && moves.some((move) => move.kind === 'payout')) {
    const combined: ChipTransfer[] = [];
    for (const move of moves) {
      const existing = combined.find((item) => item.to === move.to);
      if (existing) {
        existing.amount += move.amount;
        if (move.kind === 'payout') existing.kind = 'payout';
      } else combined.push({ ...move, delay: 0 });
    }
    return combined;
  }
  return moves;
}
