import type { GameState, LegalActions } from './types';

export function getLegalActions(s: GameState): LegalActions {
  const h = s.hand,
    p = s.players.find((p) => p.id === h?.actorId) ?? null;
  if (s.status !== 'playing' || h?.phase !== 'betting' || !p)
    return {
      actor: null,
      callAdditional: 0,
      minRaiseAdditional: 0,
      maxAdditional: 0,
      canRaise: false,
      canCheck: false,
      canCall: false,
      reasonCode: 'NOT_ACTOR',
    };
  const opponents = s.players.filter((o) => o.id !== p.id && !o.folded && !o.eliminated),
    hasOpponent = opponents.some((o) => o.stack > 0);
  const target = hasOpponent ? h.W : Math.max(0, ...opponents.map((o) => o.B));
  const callAdditional = Math.min(p.stack, Math.max(0, target - p.B));
  const canRaise = hasOpponent && (p.actedAt === null || h.W >= p.reopenAt) && p.B + p.stack > h.W;
  return {
    actor: p,
    callAdditional,
    minRaiseAdditional: h.W + h.R - p.B,
    maxAdditional: p.stack,
    canRaise,
    canCheck: callAdditional === 0,
    canCall: callAdditional > 0,
    reasonCode: !hasOpponent ? 'NO_OPPONENT' : !canRaise ? 'RAISE_CLOSED' : null,
  };
}
