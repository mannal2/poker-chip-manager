import { validChips } from '../settings';
import type { GameState } from '../types';
import { requireRule, type CommandHandler } from '../rule';
import { emit, settle } from '../round';

// 토너먼트가 진행 중인지 확인하고 현재 핸드를 반환한다. allowEnded가 참이면 종료 상태도 허용한다
/** In-hand commands need a running tournament; UNDO also works right after it ends. */
export function inPlay(s: GameState, allowEnded = false) {
  requireRule(s.status === 'playing' || (allowEnded && s.status === 'ended'));
  return s.hand!;
}

// 저장된 스냅샷으로 상태를 되돌리고 되돌림 이벤트를 남긴다
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

// 다음 핸드부터 적용할 블라인드를 예약한다
const scheduleBlinds: CommandHandler<'SCHEDULE_BLINDS'> = (s, cmd, c, events) => {
  inPlay(s);
  requireRule(validChips(cmd.sb) && validChips(cmd.bb) && cmd.sb < cmd.bb, 'INVALID_BLINDS');
  s.pendingBlinds = { sb: cmd.sb, bb: cmd.bb };
  if (s.undo) s.undo.pendingBlinds = structuredClone(s.pendingBlinds);
  emit(s, c, events, 'BLINDS_SCHEDULED', s.pendingBlinds);
};

// 승자 선택대로 팟을 정산한다
const settleHand: CommandHandler<'SETTLE_HAND'> = (s, cmd, c, events) => {
  const h = inPlay(s);
  requireRule(h.phase === 'settlement' && cmd.winners);
  settle(s, cmd.winners, c, events);
};

// 토너먼트를 중단 상태로 바꾼다
const abort: CommandHandler<'ABORT'> = (s, _cmd, c, events) => {
  const h = inPlay(s);
  s.status = 'aborted';
  h.actorId = null;
  s.undo = null;
  emit(s, c, events, 'ABORT', {});
};

// 핸드 흐름 명령별 핸들러 모음
export const flowHandlers = {
  UNDO: undo,
  SCHEDULE_BLINDS: scheduleBlinds,
  SETTLE_HAND: settleHand,
  ABORT: abort,
};
