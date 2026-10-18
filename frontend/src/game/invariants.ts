import type { GameState } from './types';
export function assertInvariants(s: GameState): void {
  const chips = [s.pot, s.initialTotal, ...s.players.flatMap((p) => [p.stack, p.B, p.H])];
  if (chips.some((n) => !Number.isSafeInteger(n) || n < 0 || n % 5 !== 0))
    throw Error('INVALID_CHIPS');
  if (s.players.reduce((n, p) => n + p.stack, 0) + s.pot !== s.initialTotal)
    throw Error('CHIP_TOTAL');
  if (s.players.reduce((n, p) => n + p.H, 0) !== s.pot || s.players.some((p) => p.B > p.H))
    throw Error('POT_LEDGER');
  if (new Set(s.players.map((p) => p.id)).size !== s.players.length)
    throw Error('DUPLICATE_PLAYER');
  if (s.hand) {
    const h = s.hand,
      p = s.players.find((p) => p.id === h.actorId);
    if (
      h.phase === 'betting' &&
      s.status === 'playing' &&
      (!p || p.folded || p.eliminated || p.stack === 0 || !h.pending.includes(p.id))
    )
      throw Error('INVALID_ACTOR');
    if (h.phase !== 'betting' && h.actorId !== null) throw Error('UNEXPECTED_ACTOR');
  }
}
