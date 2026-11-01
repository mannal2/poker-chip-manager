import { expect, it } from 'vitest';
import {
  isRoomSnapshot,
  isJoinResponse,
  isCommandResponse,
} from '../../src/features/online-game/api/types';
import { toGameState, viewSeatOf } from '../../src/features/online-game/model/toGameState';
import { fixture } from './fixtures';

// 딜러가 없는 대기방을 참가자 ID가 유지되는 준비 상태로 표시한다.
it('maps a waiting roster and preserves an unselected dealer', () => {
  const joined = fixture('join-room');
  if (!isJoinResponse(joined)) throw Error('Invalid fixture');
  const state = toGameState(joined.state);
  expect(state.status).toBe('setup');
  expect(state.settings.button).toBe(-1);
  expect(state.settings.names).toEqual(['Alice', 'Bob']);
  expect(state.players.map((p) => p.id)).toEqual(
    joined.state.participants.map((p) => p.participantId),
  );
  expect(state.players.map((p) => p.stack)).toEqual([1000, 1000]);
  expect(viewSeatOf(joined.state)).toBe(1);
});

// 진행 중인 서버 게임과 취소 기록 및 대기 차례를 그대로 유지한다.
it('preserves game, undo and pending without recomputing rules', () => {
  const response = fixture('command-applied');
  if (!isCommandResponse(response) || !response.latestState) throw Error('Invalid fixture');
  const state = toGameState(response.latestState);
  expect(state).toEqual(response.latestState.game);
  expect(state.hand?.pending).toEqual(['p1']);
  expect(state.undo?.hand?.pending).toEqual(['p0', 'p1']);
  expect(state.undo?.pot).toBe(15);
});

// 명단 좌석 대신 게임에서 본인 playerId의 위치를 찾는다.
it('finds the viewer by player identity in a running game', () => {
  const snapshot = fixture('snapshot-playing');
  if (!isRoomSnapshot(snapshot) || !snapshot.game) throw Error('Invalid fixture');
  snapshot.you.participantId = snapshot.participants[1].participantId;
  snapshot.participants[1].seat = 0;
  expect(viewSeatOf(snapshot)).toBe(1);
});
