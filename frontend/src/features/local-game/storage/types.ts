import type { GameSettings } from '../../../game/settings';
import type { GameState, GameCommand } from '../../../game/types';

export interface ControlLease {
  screenId: string;
  generation: number;
}
export interface StoredGame {
  schemaVersion: number;
  rulesVersion: number;
  state: GameState;
  eventSequence: number;
}
export interface Request {
  requestId: string;
  sequence: number;
  lease: ControlLease;
  expectedVersion: number;
  tournamentId: string;
  handId?: string;
  command: GameCommand | { type: 'NEW_TOURNAMENT'; settings: GameSettings };
}
export interface DispatchResult {
  status: 'APPLIED' | 'REJECTED' | 'UNKNOWN';
  requestId: string;
  state: GameState | null;
  reason?: string;
  resultVersion?: number;
}
export interface ControlRecord extends ControlLease {
  highWatermark: number;
  results: Array<{
    sequence: number;
    requestId: string;
    fingerprint: string;
    result: Omit<DispatchResult, 'state'>;
  }>;
}
