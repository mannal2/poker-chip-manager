import type { GameCommand } from '../../../game/types';

// 현재 사용자가 할 수 있는 조작 권한 목록
/** What the current viewer may do; modes compute it (local: everything, online: from the server). */
export interface GameCapabilities {
  canAct: boolean;
  canUndo: boolean;
  canSettle: boolean;
  canEditSetup: boolean;
  canEditBlinds: boolean;
}

// 모든 조작이 허용된 권한 값
export const fullCapabilities: GameCapabilities = {
  canAct: true,
  canUndo: true,
  canSettle: true,
  canEditSetup: true,
  canEditBlinds: true,
};

// 명령 종류별로 필요한 권한 매핑
const required: Partial<Record<GameCommand['type'], keyof GameCapabilities>> = {
  CHECK: 'canAct',
  CALL: 'canAct',
  BET: 'canAct',
  RAISE: 'canAct',
  FOLD: 'canAct',
  ALL_IN: 'canAct',
  UNDO: 'canUndo',
  SETTLE_HAND: 'canSettle',
  SETUP_UPDATE: 'canEditSetup',
  START_TOURNAMENT: 'canEditSetup',
  SCHEDULE_BLINDS: 'canEditBlinds',
};

// 명령 실행에 필요한 권한을 돌려준다
export function requiredCapability(command: GameCommand['type']) {
  return required[command];
}

// 해당 명령을 실행할 권한이 있는지 확인한다
/** Flow commands the mode issues itself (abort) need no capability. */
export function permits(capabilities: GameCapabilities, command: GameCommand['type']) {
  const capability = required[command];
  return capability === undefined || capabilities[capability];
}
