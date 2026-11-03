import { expect, it } from 'vitest';
import { isRoomSnapshot } from '../../src/features/online-game/api/types';
import { toGameState } from '../../src/features/online-game/model/toGameState';
import {
  toServerCommands,
  isHandScoped,
} from '../../src/features/online-game/model/toServerCommands';
import { fixture } from './fixtures';

// 대기방의 검증된 상태와 편집 설정을 준비한다
function waiting() {
  const snapshot = fixture('snapshot-waiting');
  if (!isRoomSnapshot(snapshot)) throw Error('Invalid fixture');
  return { snapshot, settings: toGameState(snapshot).settings };
}

// 드래그 저장에서 딜러의 신원을 유지하고 좌석 명령만 만든다
it('emits only seat order for a drag that retains the dealer', () => {
  const { snapshot, settings } = waiting();
  const order = snapshot.participants.map((p) => p.participantId).reverse();
  expect(
    toServerCommands(
      {
        type: 'SETUP_UPDATE',
        order,
        settings: { ...settings, names: ['Bob', 'Alice'], button: 1 },
      },
      snapshot,
    ),
  ).toEqual([{ type: 'SET_SEAT_ORDER', payload: { participantIds: order }, handScoped: false }]);
});

// 금액과 이름이 각각 전용 서버 명령으로 변환되는지 확인한다
it('maps amount, own name and unchanged settings separately', () => {
  const { snapshot, settings } = waiting();
  expect(
    toServerCommands({ type: 'SETUP_UPDATE', settings: { ...settings, initial: 2000 } }, snapshot),
  ).toEqual([
    { type: 'SET_SETTINGS', payload: { initial: 2000, sb: 5, bb: 10 }, handScoped: false },
  ]);
  expect(
    toServerCommands(
      { type: 'SETUP_UPDATE', settings: { ...settings, names: ['Alicia', 'Bob'] } },
      snapshot,
    ),
  ).toEqual([{ type: 'RENAME', payload: { name: 'Alicia' }, handScoped: false }]);
  expect(toServerCommands({ type: 'SETUP_UPDATE', settings }, snapshot)).toEqual([]);
  expect(
    toServerCommands(
      { type: 'SETUP_UPDATE', settings: { ...settings, names: ['Alice', 'Bobby'] } },
      snapshot,
    ),
  ).toEqual([]);
});

// 여러 설정을 변경하면 순서와 참가자 식별자를 서버 계약에 맞춘다
it('orders seat, dealer, amounts and own rename when all change', () => {
  const { snapshot, settings } = waiting();
  const [alice, bob] = snapshot.participants.map((p) => p.participantId);
  expect(
    toServerCommands(
      {
        type: 'SETUP_UPDATE',
        order: [bob, alice],
        settings: { ...settings, names: ['Bob', 'Alicia'], button: 0, bb: 20 },
      },
      snapshot,
    ),
  ).toEqual([
    { type: 'SET_SEAT_ORDER', payload: { participantIds: [bob, alice] }, handScoped: false },
    { type: 'SET_DEALER', payload: { participantId: bob }, handScoped: false },
    { type: 'SET_SETTINGS', payload: { initial: 1000, sb: 5, bb: 20 }, handScoped: false },
    { type: 'RENAME', payload: { name: 'Alicia' }, handScoped: false },
  ]);
});

// 베팅 명령에서 클라이언트 플레이어 ID를 제외하고 핸드 범위를 지정한다
it('sends betting amounts without a playerId and maps flow payloads', () => {
  const { snapshot } = waiting();
  expect(
    toServerCommands({ type: 'BET', additional: 25, playerId: 'untrusted' }, snapshot),
  ).toEqual([{ type: 'BET', payload: { additional: 25 }, handScoped: true }]);
  expect(toServerCommands({ type: 'START_TOURNAMENT' }, snapshot)).toEqual([
    { type: 'START', handScoped: false },
  ]);
  expect(toServerCommands({ type: 'SETTLE_HAND', winners: { pot0: ['p0'] } }, snapshot)).toEqual([
    { type: 'SETTLE_HAND', payload: { winners: { pot0: ['p0'] } }, handScoped: true },
  ]);
  expect(toServerCommands({ type: 'SCHEDULE_BLINDS', sb: 10, bb: 20 }, snapshot)).toEqual([
    { type: 'SCHEDULE_BLINDS', payload: { sb: 10, bb: 20 }, handScoped: false },
  ]);
});

// 핸드 범위가 필요한 명령 집합과 방 범위 명령을 구분한다
it.each(['CHECK', 'CALL', 'BET', 'RAISE', 'FOLD', 'ALL_IN', 'SETTLE_HAND', 'SETTLEMENT_DRAFT'])(
  'marks %s as hand scoped',
  (type) => {
    expect(isHandScoped(type)).toBe(true);
  },
);

// 취소와 중단은 핸드 ID를 요구하지 않는다
it.each(['UNDO', 'ABORT'] as const)('maps %s without a payload or hand scope', (type) => {
  const { snapshot } = waiting();
  expect(toServerCommands({ type }, snapshot)).toEqual([{ type, handScoped: false }]);
  expect(isHandScoped(type)).toBe(false);
});
