import { normalizeName } from '../settings';
import type { GameState, Player } from '../types';
import { requireRule, type CommandHandler } from '../rule';
import { emit } from '../round';

/** Seats a new or returning player between seats or in an eliminated seat; the stack is dealt in next hand. */
const MAX_SEATS = 10;

// 지금 플레이어와 이전 플레이어의 p<숫자> 중 최댓값에 1을 더한 새 id를 돌려준다
export function nextPlayerId(s: GameState): string {
  const ids = [...s.players, ...(s.formerPlayers ?? [])].map((p) => /^p(\d+)$/.exec(p.id)?.[1]);
  return `p${Math.max(-1, ...ids.map((n) => (n === undefined ? -1 : Number(n)))) + 1}`;
}

// 삽입 위치 이상을 가리키는 핸드 좌석 번호를 1씩 민다
function shiftSeats(s: GameState, from: number, by: 1 | -1) {
  const h = s.hand;
  if (!h) return;
  for (const key of ['buttonSeat', 'sbSeat', 'bbSeat'] as const) if (h[key] >= from) h[key] += by;
}

// 바이인 명령을 검증해 새 플레이어를 자리에 앉히고 칩 합계를 늘린다
const buyIn: CommandHandler<'BUY_IN'> = (s, cmd, c, events) => {
  requireRule(s.status === 'playing');
  const target = cmd.reentryOf ? s.players.find((p) => p.id === cmd.reentryOf) : undefined;
  let name: string;
  if (cmd.reentryOf) {
    requireRule(target?.eliminated);
    name = target.name;
  } else {
    const normalized = typeof cmd.name === 'string' ? normalizeName(cmd.name) : null;
    requireRule(normalized !== null, 'INVALID_NAMES');
    name = normalized;
  }
  requireRule(
    !s.players.some((p) => !p.eliminated && p.name.toLowerCase() === name.toLowerCase()),
    'INVALID_NAMES',
  );
  const placement = cmd.placement;
  let index: number;
  if (placement?.kind === 'between') {
    const after = s.players.findIndex((p) => p.id === placement.after);
    requireRule(s.players.length < MAX_SEATS && after >= 0, 'INVALID_SEATS');
    index = after + 1;
  } else {
    requireRule(placement?.kind === 'replace', 'INVALID_SEATS');
    index = s.players.findIndex((p) => p.id === placement.playerId);
    requireRule(
      index >= 0 && s.players[index].eliminated && !s.players[index].joining,
      'INVALID_SEATS',
    );
  }
  const entry = (target ? (target.entry ?? 1) : 0) + 1;
  const player: Player = {
    id: nextPlayerId(s),
    name,
    stack: s.settings.initial,
    eliminated: false,
    folded: true,
    B: 0,
    H: 0,
    actedAt: null,
    reopenAt: 0,
    entry,
    joining: 'next-hand',
  };
  if (placement.kind === 'between') {
    s.players.splice(index, 0, player);
    shiftSeats(s, index, 1);
  } else {
    const [old] = s.players.splice(index, 1, player);
    player.replaced = old;
    s.formerPlayers = [...(s.formerPlayers ?? []), { id: old.id, name: old.name }];
  }
  s.initialTotal += s.settings.initial;
  s.undo = null;
  emit(s, c, events, 'BUY_IN', {
    playerId: player.id,
    entry,
    ...(cmd.reentryOf ? { reentryOf: cmd.reentryOf } : {}),
    ...(player.replaced ? { replaced: player.replaced.id } : {}),
  });
};

// 첫 카드 전의 바이인을 취소해 원래 자리 상태로 되돌린다
const cancelBuyIn: CommandHandler<'CANCEL_BUY_IN'> = (s, cmd, c, events) => {
  requireRule(s.status === 'playing');
  const index = s.players.findIndex((p) => p.id === cmd.playerId);
  requireRule(index >= 0 && s.players[index].joining);
  const { replaced } = s.players[index];
  if (replaced) {
    s.players[index] = replaced;
    s.formerPlayers = (s.formerPlayers ?? []).filter((p) => p.id !== replaced.id);
  } else {
    s.players.splice(index, 1);
    shiftSeats(s, index + 1, -1);
  }
  s.initialTotal -= s.settings.initial;
  s.undo = null;
  emit(s, c, events, 'BUY_IN_CANCEL', { playerId: cmd.playerId });
};

// 바이인 명령별 핸들러 모음
export const buyInHandlers = { BUY_IN: buyIn, CANCEL_BUY_IN: cancelBuyIn };
