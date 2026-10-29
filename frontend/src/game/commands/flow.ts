import { validChips } from '../settings';
import type { GameState } from '../types';
import { requireRule, type CommandHandler } from '../rule';
import { advanceStreet, emit, finishRound, settle } from '../round';

/** In-hand commands need a running tournament; UNDO also works right after it ends. */
export function inPlay(s: GameState, allowEnded = false) {
  requireRule(s.status === 'playing' || (allowEnded && s.status === 'ended'));
  return s.hand!;
}

const undo: CommandHandler<'UNDO'> = (s, _cmd, c, events) => {
  inPlay(s, true);
  requireRule(s.undo, 'UNDO_LOCKED');
  const pending = s.hand?.id === s.undo.hand?.id ? s.pendingBlinds : s.undo.pendingBlinds,
    version = s.version;
  const { eventIds, ...snapshot } = s.undo;
  Object.assign(s, snapshot);
  s.version = version;
  s.pendingBlinds = pending;
  s.undo = null;
  emit(s, c, events, 'UNDO', eventIds ? { eventIds } : {});
};

const beginReveal: CommandHandler<'BEGIN_REVEAL'> = (s, _cmd, c, events) => {
  const h = inPlay(s);
  requireRule(h.phase === 'revealPending');
  s.undo = null;
  h.phase = h.showdown ? 'settlement' : 'revealed';
  emit(s, c, events, 'REVEAL', { showdown: h.showdown });
};

const advance: CommandHandler<'ADVANCE_STREET'> = (s, _cmd, c, events) => {
  const h = inPlay(s);
  requireRule(h.phase === 'revealed' && !h.showdown && h.street < 3);
  advanceStreet(s, c, events);
};

const resumeFlow: CommandHandler<'RESUME_FLOW'> = (s, _cmd, c, events) => {
  const h = inPlay(s);
  requireRule(['revealPending', 'revealed'].includes(h.phase));
  finishRound(s, c, events);
};

const scheduleBlinds: CommandHandler<'SCHEDULE_BLINDS'> = (s, cmd, c, events) => {
  inPlay(s);
  requireRule(validChips(cmd.sb) && validChips(cmd.bb) && cmd.sb < cmd.bb, 'INVALID_BLINDS');
  s.pendingBlinds = { sb: cmd.sb, bb: cmd.bb };
  if (s.undo) s.undo.pendingBlinds = structuredClone(s.pendingBlinds);
  emit(s, c, events, 'BLINDS_SCHEDULED', s.pendingBlinds);
};

const settleHand: CommandHandler<'SETTLE_HAND'> = (s, cmd, c, events) => {
  const h = inPlay(s);
  requireRule(h.phase === 'settlement' && cmd.winners);
  settle(s, cmd.winners, c, events);
};

const abort: CommandHandler<'ABORT'> = (s, _cmd, c, events) => {
  const h = inPlay(s);
  s.status = 'aborted';
  h.actorId = null;
  s.undo = null;
  emit(s, c, events, 'ABORT', {});
};

export const flowHandlers = {
  UNDO: undo,
  BEGIN_REVEAL: beginReveal,
  ADVANCE_STREET: advance,
  RESUME_FLOW: resumeFlow,
  SCHEDULE_BLINDS: scheduleBlinds,
  SETTLE_HAND: settleHand,
  ABORT: abort,
};
