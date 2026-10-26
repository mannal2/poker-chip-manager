import type {
  GameState,
  GameCommand,
  TransitionContext,
  TransitionResult,
  LegalActions,
  GameEvent,
} from './types';
import { validateSettings, validChips, type GameSettings } from './settings';
import { nextSeat, nextPositions, initialBlindSeats } from './positions';
import { assertInvariants } from './invariants';
import { buildPots, previewSettlement } from './settlement';
import type { WinnerSelection } from './types';
import type { RuleErrorCode } from './errors';
class Invalid extends Error {
  declare message: RuleErrorCode;
}
function requireRule(
  condition: unknown,
  message: RuleErrorCode = 'INVALID_ACTION',
): asserts condition {
  if (!condition) throw new Invalid(message);
}
export function createTournament(settings: GameSettings, c: TransitionContext): GameState {
  const v = validateSettings(settings);
  if (!v.ok) throw Error(v.code);
  return {
    tournamentId: c.id,
    version: 0,
    status: 'setup',
    settings: v.settings,
    initialTotal: settings.initial * settings.names.length,
    setupOrder: settings.names.map((_, i) => `p${i}`),
    players: v.settings.names.map((name, i) => ({
      id: `p${i}`,
      name,
      stack: settings.initial,
      eliminated: false,
      folded: false,
      B: 0,
      H: 0,
      actedAt: null,
      reopenAt: 0,
    })),
    hand: null,
    pot: 0,
    pendingBlinds: null,
    undo: null,
  };
}
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
function pay(s: GameState, index: number, amount: number) {
  const p = s.players[index];
  p.stack -= amount;
  p.B += amount;
  p.H += amount;
  s.pot += amount;
}
function emit(
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
function resolveRound(s: GameState, after: number, c: TransitionContext, events: GameEvent[]) {
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
function advanceStreet(s: GameState, c: TransitionContext, events: GameEvent[]) {
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
function finishRound(s: GameState, c: TransitionContext, events: GameEvent[]) {
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
function startHand(s: GameState, c: TransitionContext, events: GameEvent[]) {
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
function settle(s: GameState, winners: WinnerSelection, c: TransitionContext, events: GameEvent[]) {
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
export function transition(
  input: GameState,
  cmd: GameCommand,
  c: TransitionContext,
): TransitionResult {
  const s = structuredClone(input),
    events: GameEvent[] = [];
  try {
    if (cmd.type === 'START_TOURNAMENT') {
      requireRule(s.status === 'setup');
      const v = validateSettings(s.settings);
      requireRule(v.ok);
      requireRule(s.settings.button >= 0, 'DEALER_REQUIRED');
      s.status = 'playing';
      startHand(s, c, events);
    } else if (cmd.type === 'SETUP_UPDATE') {
      requireRule(s.status === 'setup' && cmd.settings);
      const v = validateSettings(cmd.settings);
      requireRule(v.ok, 'INVALID_SETTINGS');
      const old = s.players;
      const creation = s.setupOrder ?? old.map((p) => p.id);
      if (cmd.order)
        requireRule(
          cmd.order.length === v.settings.names.length &&
            cmd.order.every((id) => old.some((p) => p.id === id)),
        );
      const fresh = createTournament(v.settings, { ...c, id: s.tournamentId });
      s.settings = fresh.settings;
      s.initialTotal = fresh.initialTotal;
      s.players = fresh.players.map((p, i) => ({
        ...p,
        id: cmd.order?.[i] ?? old[i]?.id ?? `${c.id}:p${i}`,
      }));
      requireRule(new Set(s.players.map((p) => p.id)).size === s.players.length);
      const ids = s.players.map((p) => p.id);
      s.setupOrder = [
        ...creation.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !creation.includes(id)),
      ];
    } else if (cmd.type === 'SET_VIEW') {
      requireRule(
        Number.isInteger(cmd.viewSeat) && cmd.viewSeat! >= 0 && cmd.viewSeat! < s.players.length,
      );
      s.settings.viewSeat = cmd.viewSeat!;
    } else {
      requireRule(s.status === 'playing' || (cmd.type === 'UNDO' && s.status === 'ended'));
      const h = s.hand!;
      if (cmd.type === 'UNDO') {
        requireRule(s.undo, 'UNDO_LOCKED');
        const pending = s.hand?.id === s.undo.hand?.id ? s.pendingBlinds : s.undo.pendingBlinds,
          view = s.settings.viewSeat,
          version = s.version;
        const { eventIds, ...snapshot } = s.undo;
        Object.assign(s, snapshot);
        s.version = version;
        s.pendingBlinds = pending;
        s.settings.viewSeat = view;
        s.undo = null;
        emit(s, c, events, 'UNDO', eventIds ? { eventIds } : {});
      } else if (cmd.type === 'BEGIN_REVEAL') {
        requireRule(h.phase === 'revealPending');
        s.undo = null;
        h.phase = h.showdown ? 'settlement' : 'revealed';
        emit(s, c, events, 'REVEAL', { showdown: h.showdown });
      } else if (cmd.type === 'ADVANCE_STREET') {
        requireRule(h.phase === 'revealed' && !h.showdown && h.street < 3);
        advanceStreet(s, c, events);
      } else if (cmd.type === 'RESUME_FLOW') {
        requireRule(['revealPending', 'revealed'].includes(h.phase));
        finishRound(s, c, events);
      } else if (cmd.type === 'SCHEDULE_BLINDS') {
        requireRule(
          validChips(cmd.sb!) && validChips(cmd.bb!) && cmd.sb! < cmd.bb!,
          'INVALID_BLINDS',
        );
        s.pendingBlinds = { sb: cmd.sb!, bb: cmd.bb! };
        if (s.undo) s.undo.pendingBlinds = structuredClone(s.pendingBlinds);
        emit(s, c, events, 'BLINDS_SCHEDULED', s.pendingBlinds);
      } else if (cmd.type === 'SETTLE_HAND') {
        requireRule(h.phase === 'settlement' && cmd.winners);
        settle(s, cmd.winners, c, events);
      } else if (cmd.type === 'ABORT') {
        s.status = 'aborted';
        h.actorId = null;
        s.undo = null;
        emit(s, c, events, 'ABORT', {});
      } else {
        requireRule(h.phase === 'betting');
        const legal = getLegalActions(s),
          p = legal.actor;
        requireRule(p && (!cmd.playerId || cmd.playerId === p.id));
        let amount = 0;
        if (cmd.type === 'CHECK') requireRule(legal.canCheck);
        else if (cmd.type === 'CALL') {
          requireRule(legal.canCall);
          amount = legal.callAdditional;
        } else if (cmd.type === 'FOLD') p.folded = true;
        else {
          requireRule(['BET', 'RAISE', 'ALL_IN'].includes(cmd.type));
          requireRule(
            cmd.type === 'ALL_IN' ||
              (cmd.type === 'BET' && h.W === 0) ||
              (cmd.type === 'RAISE' && h.W > 0),
          );
          amount = cmd.type === 'ALL_IN' ? p.stack : cmd.additional!;
          requireRule(
            Number.isSafeInteger(amount) && amount > 0 && amount % 5 === 0 && amount <= p.stack,
            'INVALID_AMOUNT',
          );
          const target = p.B + amount;
          if (target <= h.W) {
            requireRule(amount === p.stack && amount <= legal.callAdditional);
          } else {
            requireRule(legal.canRaise, 'RAISE_CLOSED');
            requireRule(amount === p.stack || target >= h.W + h.R, 'MIN_RAISE');
            const increase = target - h.W;
            if (increase >= h.R) h.R = increase;
            h.W = target;
          }
        }
        pay(s, s.players.indexOf(p), amount);
        p.actedAt = h.W;
        p.reopenAt = h.W + h.R;
        h.pending = h.pending.filter((id) => id !== p.id);
        for (const other of s.players)
          if (
            !other.eliminated &&
            !other.folded &&
            other.stack > 0 &&
            other.B < h.W &&
            !h.pending.includes(other.id)
          )
            h.pending.push(other.id);
        emit(s, c, events, cmd.type, { playerId: p.id, additional: amount });
        resolveRound(s, s.players.indexOf(p), c, events);
      }
    }
    if (['CHECK', 'CALL', 'BET', 'RAISE', 'FOLD', 'ALL_IN', 'SETTLE_HAND'].includes(cmd.type)) {
      const { undo: ignored, ...snapshot } = structuredClone(input);
      void ignored;
      s.undo = { ...snapshot, eventIds: events.map((event) => event.id) };
    }
    s.version = input.version + 1;
    assertInvariants(s);
    return { ok: true, state: s, events };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, errorCode: e.message };
    throw e;
  }
}
