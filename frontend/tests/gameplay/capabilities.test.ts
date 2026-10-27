import { it, expect } from 'vitest';
import { fullCapabilities, permits } from '../../src/features/gameplay/model/capabilities';

it('로컬 전체 권한은 화면이 보내는 모든 명령을 허용한다', () => {
  for (const type of [
    'CALL',
    'RAISE',
    'UNDO',
    'SETTLE_HAND',
    'SETUP_UPDATE',
    'START_TOURNAMENT',
    'SCHEDULE_BLINDS',
  ] as const)
    expect(permits(fullCapabilities, type)).toBe(true);
});

it('명령마다 해당 권한 하나만 확인한다', () => {
  const none = {
    canAct: false,
    canUndo: false,
    canSettle: false,
    canEditSetup: false,
    canEditBlinds: false,
  };
  expect(permits({ ...none, canAct: true }, 'BET')).toBe(true);
  expect(permits({ ...none, canAct: true }, 'UNDO')).toBe(false);
  expect(permits({ ...none, canUndo: true }, 'UNDO')).toBe(true);
  expect(permits({ ...none, canSettle: true }, 'SETTLE_HAND')).toBe(true);
  expect(permits({ ...none, canEditSetup: true }, 'START_TOURNAMENT')).toBe(true);
  expect(permits({ ...none, canEditSetup: true }, 'SCHEDULE_BLINDS')).toBe(false);
  expect(permits({ ...none, canEditBlinds: true }, 'SCHEDULE_BLINDS')).toBe(true);
});

it('모드가 직접 진행하는 흐름 명령은 권한 없이 허용한다', () => {
  const none = {
    canAct: false,
    canUndo: false,
    canSettle: false,
    canEditSetup: false,
    canEditBlinds: false,
  };
  for (const type of ['RESUME_FLOW', 'BEGIN_REVEAL', 'ADVANCE_STREET', 'ABORT'] as const)
    expect(permits(none, type)).toBe(true);
});
