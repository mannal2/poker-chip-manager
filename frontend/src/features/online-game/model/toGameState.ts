import type { GameState } from '../../../game/types';
import type { RoomSnapshot } from '../api/types';

// 서버 게임은 그대로 보존하고 대기방 명단만 준비 화면 상태로 바꾼다.
export function toGameState(snapshot: RoomSnapshot): GameState {
  if (snapshot.game) return structuredClone(snapshot.game);
  const players = snapshot.participants.map((p) => ({
    id: p.participantId,
    name: p.name,
    stack: snapshot.settings.initial,
    eliminated: false,
    folded: false,
    B: 0,
    H: 0,
    actedAt: null,
    reopenAt: 0,
  }));
  return {
    tournamentId: snapshot.tournamentId ?? snapshot.roomId,
    version: snapshot.stateVersion,
    status: 'setup',
    settings: { ...snapshot.settings, names: players.map((p) => p.name) },
    initialTotal: players.length * snapshot.settings.initial,
    setupOrder: players.map((p) => p.id),
    players,
    hand: null,
    pot: 0,
    pendingBlinds: null,
    undo: null,
  };
}

// 명단의 본인 식별자를 게임 좌석 또는 대기방 좌석으로 변환한다.
export function viewSeatOf(snapshot: RoomSnapshot): number {
  const you = snapshot.participants.find((p) => p.participantId === snapshot.you.participantId);
  return snapshot.game
    ? snapshot.game.players.findIndex((p) => p.id === you?.playerId)
    : (you?.seat ?? -1);
}
