import { getLegalActions } from '../legal';
import { requireRule, type CommandHandler } from '../rule';
import { emit, pay, resolveRound } from '../round';
import { inPlay } from './flow';

type BettingType = 'CHECK' | 'CALL' | 'FOLD' | 'ALL_IN' | 'BET' | 'RAISE';

const bet: CommandHandler<BettingType> = (s, cmd, c, events) => {
  const h = inPlay(s);
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
    requireRule(
      cmd.type === 'ALL_IN' ||
        (cmd.type === 'BET' && h.W === 0) ||
        (cmd.type === 'RAISE' && h.W > 0),
    );
    // Requests read back from storage may lack the field; the amount check below rejects it.
    amount = cmd.type === 'ALL_IN' ? p.stack : 'additional' in cmd ? cmd.additional : NaN;
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
};

export const bettingHandlers = {
  CHECK: bet,
  CALL: bet,
  FOLD: bet,
  ALL_IN: bet,
  BET: bet,
  RAISE: bet,
};
