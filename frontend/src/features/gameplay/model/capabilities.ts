import type { GameCommand } from '../../../game/types';

/** What the current viewer may do; modes compute it (local: everything, online: from the server). */
export interface GameCapabilities {
  canAct: boolean;
  canUndo: boolean;
  canSettle: boolean;
  canEditSetup: boolean;
  canEditBlinds: boolean;
}

export const fullCapabilities: GameCapabilities = {
  canAct: true,
  canUndo: true,
  canSettle: true,
  canEditSetup: true,
  canEditBlinds: true,
};

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

/** Flow commands the mode issues itself (reveal, resume, abort) need no capability. */
export function permits(capabilities: GameCapabilities, command: GameCommand['type']) {
  const capability = required[command];
  return capability === undefined || capabilities[capability];
}
