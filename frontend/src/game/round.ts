import type { GameEvent, GameState, TransitionContext, WinnerSelection } from './types';
import { nextSeat, nextPositions, initialBlindSeats } from './positions';
import { buildPots, previewSettlement } from './settlement';
import { requireRule } from './rule';

/** Hand progression shared by the command handlers: payments, rounds, streets and payouts. */
export function pay(s: GameState, index: number, amount: number) {
  const p = s.players[index];
  p.stack -= amount;
  p.B += amount;
  p.H += amount;
  s.pot += amount;
}
export function emit(
  s: GameState,
  c: TransitionContext,
  events: GameEvent[],
  type: string,
  details: unknown,
) {
  events.push({
    id: `${c.id}:${events.length}`,
    at: c.at,
    tournamentId: s.tournamentId,
    hand: s.hand?.number ?? 0,
    type,
    details,
  });
}
export function returnUncalled(s: GameState): { playerId: string; amount: number } | null {
  const sorted = [...s.players].sort((a, b) => b.B - a.B);
  if (sorted[0].B <= sorted[1].B) return null;
  const p = sorted[0],
    amount = p.B - sorted[1].B;
  p.stack += amount;
  p.B -= amount;
  p.H -= amount;
  s.pot -= amount;
  return { playerId: p.id, amount };
}
export function resolveRound(
  s: GameState,
  after: number,
  c: TransitionContext,
  events: GameEvent[],
) {
  const h = s.hand!,
    live = s.players.filter((p) => !p.folded && !p.eliminated),
    able = live.filter((p) => p.stack > 0);
  h.pending = h.pending.filter((id) => able.some((p) => p.id === id));
  if (able.length === 1) {
    const p = able[0],
      maxOther = Math.max(0, ...live.filter((o) => o !== p).map((o) => o.B));
    h.pending = p.B < maxOther ? [p.id] : [];
  }
  if (live.length === 1) {
    const returned = returnUncalled(s);
    if (returned) emit(s, c, events, 'RETURN', returned);
    const winners = Object.fromEntries(buildPots(s).map((p) => [p.id, [live[0].id]]));
    settle(s, winners, c, events);
    return;
  }
  if (h.pending.length) {
    h.actorId =
      s.players[
        nextSeat(
          after,
          s.players.map((p) => h.pending.includes(p.id)),
        )
      ].id;
    return;
  }
  finishRound(s, c, events);
}
export function advanceStreet(s: GameState, c: TransitionContext, events: GameEvent[]) {
  const h = s.hand!;
  h.street++;
  h.W = 0;
  h.R = h.bb;
  h.phase = 'betting';
  s.players.forEach((p) => {
    p.B = 0;
    p.actedAt = null;
    p.reopenAt = 0;
  });
  h.pending = s.players.filter((p) => !p.folded && !p.eliminated && p.stack > 0).map((p) => p.id);
  emit(s, c, events, 'STREET', { street: h.street });
  resolveRound(s, h.buttonSeat, c, events);
}
export function finishRound(s: GameState, c: TransitionContext, events: GameEvent[]) {
  const h = s.hand!;
  const returned = returnUncalled(s);
  if (returned) emit(s, c, events, 'RETURN', returned);
  h.actorId = null;
  h.showdown =
    h.street === 3 ||
    s.players.filter((p) => !p.folded && !p.eliminated && p.stack > 0).length <= 1;
  s.undo = null;
  emit(s, c, events, 'REVEAL', { showdown: h.showdown });
  if (h.showdown) h.phase = 'settlement';
  else advanceStreet(s, c, events);
}
export function startHand(s: GameState, c: TransitionContext, events: GameEvent[]) {
  const previous = s.hand,
    alive = s.players.map((p) => !p.eliminated);
  const position = previous
    ? nextPositions(alive, previous)
    : { buttonSeat: s.settings.button, ...initialBlindSeats(s.settings.button, alive) };
  const blinds =
    s.pendingBlinds ??
    (previous ? { sb: previous.sb, bb: previous.bb } : { sb: s.settings.sb, bb: s.settings.bb });
  s.pendingBlinds = null;
  s.players.forEach((p) => {
    p.B = 0;
    p.H = 0;
    p.folded = false;
    p.actedAt = null;
    p.reopenAt = 0;
  });
  s.pot = 0;
  s.undo = null;
  const number = (previous?.number ?? 0) + 1;
  s.hand = {
    id: `${c.id}:hand:${number}`,
    number,
    street: 0,
    phase: 'betting',
    ...position,
    ...blinds,
    actorId: null,
    W: blinds.bb,
    R: blinds.bb,
    pending: s.players.filter((p) => !p.eliminated && p.stack > 0).map((p) => p.id),
    showdown: false,
  };
  for (const [seat, amount] of [
    [position.sbSeat, blinds.sb],
    [position.bbSeat, blinds.bb],
  ]) {
    if (alive[seat]) pay(s, seat, Math.min(s.players[seat].stack, amount));
  }
  emit(s, c, events, 'HAND_START', { ...position, ...blinds });
  resolveRound(s, position.bbSeat, c, events);
}
export function settle(
  s: GameState,
  winners: WinnerSelection,
  c: TransitionContext,
  events: GameEvent[],
) {
  const preview = previewSettlement(s, winners);
  requireRule(preview.ok, preview.error);
  emit(s, c, events, 'PAYOUT', { pot: s.pot, payouts: preview.payouts });
  s.players.forEach((p) => {
    p.stack += preview.payouts[p.id];
    p.B = 0;
    p.H = 0;
    if (p.stack === 0 && !p.eliminated) {
      p.eliminated = true;
      emit(s, c, events, 'ELIMINATED', { playerId: p.id });
    }
  });
  s.pot = 0;
  s.undo = null;
  if (s.players.filter((p) => !p.eliminated).length === 1) {
    s.status = 'ended';
    s.hand!.actorId = null;
    s.hand!.phase = 'settlement';
    emit(s, c, events, 'TOURNAMENT_END', { winner: s.players.find((p) => !p.eliminated)!.id });
  } else startHand(s, c, events);
}
