import type { GameSettings } from '../../../game/settings';
import type { GameState, GameCommand } from '../../../game/types';

// 화면이 가진 조작권(화면 id와 세대)
export interface ControlLease {
  screenId: string;
  generation: number;
}
// 저장소에 보관하는 게임 한 건과 형식/규칙 버전
export interface StoredGame {
  schemaVersion: number;
  rulesVersion: number;
  state: GameState;
  eventSequence: number;
}
// 저장소에 보내는 명령 요청(순번, 조작권, 기대 버전 포함)
export interface Request {
  requestId: string;
  sequence: number;
  lease: ControlLease;
  expectedVersion: number;
  tournamentId: string;
  handId?: string;
  command: GameCommand | { type: 'NEW_TOURNAMENT'; settings: GameSettings };
}
// 요청 처리 결과(적용, 거절, 불명확)
export interface DispatchResult {
  status: 'APPLIED' | 'REJECTED' | 'UNKNOWN';
  requestId: string;
  state: GameState | null;
  reason?: string;
  resultVersion?: number;
}
// 저장소의 조작권 기록과 최근 요청 결과
export interface ControlRecord extends ControlLease {
  highWatermark: number;
  results: Array<{
    sequence: number;
    requestId: string;
    fingerprint: string;
    result: Omit<DispatchResult, 'state'>;
  }>;
}
