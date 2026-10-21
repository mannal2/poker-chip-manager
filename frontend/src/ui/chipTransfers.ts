import type { GameState, GameCommand } from '../game/types';
import { transition } from '../game/transition';
export interface ChipTransfer {
  from: string;
  to: string;
  amount: number;
  delay: number;
  kind: 'bet' | 'return' | 'payout';
}
export function chipTransfers(state: GameState, command: GameCommand): ChipTransfer[] {
  if (!['CALL', 'BET', 'RAISE', 'ALL_IN', 'FOLD', 'CHECK', 'SETTLE_HAND'].includes(command.type))
    return [];
  const result = transition(state, command, { id: 'visual-preview', at: '' });
  if (!result.ok) return [];
  const moves: ChipTransfer[] = [];
  let delay = 0;
  for (const event of result.events) {
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
  if (command.type === 'FOLD' && moves.some((move) => move.kind === 'payout')) {
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
