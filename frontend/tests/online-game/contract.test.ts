import { expect, it } from 'vitest';
import {
  isRoomSnapshot,
  isSnapshotMessage,
  isCommandResponse,
  isJoinResponse,
  isRecoveryStatus,
} from '../../src/features/online-game/api/types';
import { toGameState } from '../../src/features/online-game/model/toGameState';
import { assertInvariants } from '../../src/game/invariants';
import { fixture } from './fixtures';
import { messageFor } from '../../src/features/gameplay/model/errorMessages';

// 서버 상태의 칩 장부와 총량을 공통 규칙으로 검증한다.
it.each(['snapshot-waiting', 'snapshot-playing', 'snapshot-settlement', 'snapshot-result'])(
  'accepts %s and preserves the chip ledger',
  (name) => {
    const value = fixture(name);
    expect(isRoomSnapshot(value)).toBe(true);
    if (!isRoomSnapshot(value)) throw Error('Invalid fixture');
    const state = toGameState(value);
    expect(state.initialTotal).toBe(state.settings.initial * state.players.length);
    expect(state.players.map((p) => p.name)).toEqual(state.settings.names);
    expect(() => assertInvariants(state)).not.toThrow();
    if (state.undo) expect(() => assertInvariants({ ...state.undo!, undo: null })).not.toThrow();
  },
);

// 각 전송 경로의 응답 구조를 실제 계약으로 확인한다.
it('accepts socket, command, join and recovery responses', () => {
  expect(isSnapshotMessage(fixture('ws-snapshot'))).toBe(true);
  expect(isCommandResponse(fixture('command-applied'))).toBe(true);
  expect(isJoinResponse(fixture('create-room'))).toBe(true);
  expect(isJoinResponse(fixture('join-room'))).toBe(true);
  expect(isRecoveryStatus(fixture('recovery-approved'))).toBe(true);
  expect(isCommandResponse({ ...(fixture('command-applied') as object), latestState: null })).toBe(
    true,
  );
});

// 중첩 필드의 형식 오류가 계약 검증을 통과하지 못하게 한다.
it('rejects malformed nested contract data', () => {
  const source = fixture('snapshot-playing') as Record<string, unknown>;
  expect(isRoomSnapshot({ ...source, stateVersion: '7' })).toBe(false);
  expect(isRoomSnapshot({ ...source, roomPhase: ['PLAYING'] })).toBe(false);
  expect(isRoomSnapshot({ ...source, participants: [{ participantId: 'a' }] })).toBe(false);
  expect(isRoomSnapshot({ ...source, game: { ...(source.game as object), players: [{}] } })).toBe(
    false,
  );
  expect(
    isRoomSnapshot({ ...source, game: { ...(source.game as object), status: ['playing'] } }),
  ).toBe(false);
  expect(isSnapshotMessage({ ...(fixture('ws-snapshot') as object), events: [{}] })).toBe(false);
  expect(isCommandResponse({ ...(fixture('command-applied') as object), latestState: {} })).toBe(
    false,
  );
  expect(isJoinResponse({ ...(fixture('create-room') as object), controlGeneration: '1' })).toBe(
    false,
  );
  expect(isRecoveryStatus({ ...(fixture('recovery-approved') as object), state: null })).toBe(
    false,
  );
  expect(isRecoveryStatus({ recoveryRequestId: 'r', status: ['PENDING'] })).toBe(false);
});

// 온라인 오류 코드를 서버 계약의 한국어 안내로 표시한다.
it('shows server rejection messages instead of unknown codes', () => {
  expect(messageFor('NOT_YOUR_TURN')).toBe('지금은 내 차례가 아닙니다.');
  expect(messageFor('RECOVERY_LIMIT')).toBe(
    '이 자리의 복구 신청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
  );
  expect(messageFor('NO_DEALER')).toBe('첫 딜러로 시작할 플레이어 카드를 선택하세요.');
});
