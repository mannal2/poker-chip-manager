import type { GameSettings } from './settings';
import type { LegalReasonCode, RuleErrorCode } from './errors';
// 플레이어 한 명의 스택과 베팅 상태
export interface Player {
  id: string;
  name: string;
  stack: number;
  eliminated: boolean;
  forfeited?: boolean;
  folded: boolean;
  B: number;
  H: number;
  actedAt: number | null;
  reopenAt: number;
}
// 핸드의 단계(베팅 중 또는 정산 대기)
export type Phase = 'betting' | 'settlement';
// 진행 중인 핸드 하나의 상태(좌석, 블라인드, 현재 베팅, 대기자)
export interface Hand {
  id: string;
  number: number;
  street: number;
  phase: Phase;
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  sb: number;
  bb: number;
  actorId: string | null;
  W: number;
  R: number;
  pending: string[];
  showdown: boolean;
}
// 토너먼트 전체 상태(플레이어, 핸드, 팟, 되돌리기 스냅샷)
export interface GameState {
  tournamentId: string;
  version: number;
  status: 'setup' | 'playing' | 'ended' | 'aborted';
  settings: GameSettings;
  initialTotal: number;
  setupOrder?: string[];
  players: Player[];
  hand: Hand | null;
  pot: number;
  pendingBlinds: { sb: number; bb: number } | null;
  undo: (Omit<GameState, 'undo'> & { eventIds?: string[] }) | null;
}
// 팟 id별로 선택된 승자 id 목록
export type WinnerSelection = Record<string, string[]>;
// 엔진이 받는 모든 명령의 종류
/** One shape per command; the server request DTOs follow the same union. */
export type GameCommand =
  | { type: 'START_TOURNAMENT' }
  | { type: 'SETUP_UPDATE'; settings: GameSettings; order?: string[] }
  | { type: 'CHECK' | 'CALL' | 'FOLD' | 'ALL_IN'; playerId?: string }
  | { type: 'BET' | 'RAISE'; additional: number; playerId?: string }
  | { type: 'SETTLE_HAND'; winners: WinnerSelection }
  | { type: 'SCHEDULE_BLINDS'; sb: number; bb: number }
  | { type: 'UNDO' | 'ABORT' };
// 한 번의 전이에 쓰이는 식별자와 시각
export interface TransitionContext {
  id: string;
  at: string;
}
// 게임에서 발생한 이벤트 하나
export interface GameEvent {
  id: string;
  at: string;
  tournamentId: string;
  hand: number;
  type: string;
  details: GameEventDetails;
  sequence?: number;
}
// 이벤트별 추가 정보와 서버의 자동 처리 및 방장 처리 표시를 담는다
export interface GameEventDetails {
  [key: string]: unknown;
  auto?: boolean;
  byHost?: boolean;
}
// 전이 결과(성공한 상태와 이벤트 또는 거절 코드)
export type TransitionResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; errorCode: RuleErrorCode };
// 현재 차례 플레이어가 선택할 수 있는 행동과 금액 한도
export interface LegalActions {
  actor: Player | null;
  callAdditional: number;
  minRaiseAdditional: number;
  maxAdditional: number;
  canRaise: boolean;
  canCheck: boolean;
  canCall: boolean;
  reasonCode: LegalReasonCode | null;
}
// 팟 하나의 금액과 수령 자격이 있는 플레이어
export interface Pot {
  id: string;
  amount: number;
  eligible: string[];
}
