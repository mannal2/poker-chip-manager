import type { GameCommand, GameState, LegalActions } from '../../game/types';
import type { useSetupEditing } from './hooks/useSetupEditing';
import type { GameCapabilities } from './model/capabilities';
import type { LoadEvents } from './model/eventPages';

// 세션 수준(제어권, 순서, 오래된 상태)의 거절 사유 코드
/** Session-level rejections (control, ordering, staleness) returned by local storage or a server. */
export type SessionRejectionCode =
  | 'CONTROL_LOST'
  | 'STALE_STATE'
  | 'TOURNAMENT_CHANGED'
  | 'NO_GAME'
  | 'REQUEST_CONFLICT'
  | 'RESULT_EXPIRED'
  | 'SEQUENCE_GAP'
  | 'REQUEST_PENDING'
  | 'NO_PENDING_REQUEST';

// 게임 화면이 모드별로 받는 상태와 명령 채널
/** Mode-provided state and command channel that the shared game screen is assembled from. */
export interface GameSession {
  state: GameState;
  busy: boolean;
  /** Viewer permissions; storage/server checks still decide the final result. */
  capabilities: GameCapabilities;
  /** Allowed betting actions and amounts (local: getLegalActions, online: server response). */
  legal: LegalActions | null;
  /** Table slot drawn at the bottom (local: chosen rotation, online: the viewer's own seat). */
  viewSeat: number;
  /** Control scope from the mode (local: lease generation); undefined disables betting drafts. */
  scope: string | number | undefined;
  /** Returns the reason the screen cannot accept input now, or null when it can. */
  guard: () => string | null;
  run: (action: () => Promise<void>) => Promise<void>;
  dispatch: (command: GameCommand) => Promise<boolean>;
  notify: (message: string) => void;
  /** Event history source for the record dialog. */
  loadEvents: LoadEvents;
}

// 설정 편집 조작 모음(모드별 추가 기능 포함)
/** Shared setup editing plus optional mode extras (local: player count and screen rotation). */
export type SetupControls = ReturnType<typeof useSetupEditing> & {
  changeCount?: (add: boolean) => void;
  rotate?: () => void;
};

// 게임 화면에서 띄울 수 있는 대화상자 종류
export type GameDialog = 'payout' | 'menu' | 'history' | 'blinds';

// 게임 화면 바깥에서 화면을 제어하기 위한 핸들
/** Imperative hooks for mode events that happen outside the screen's own commands. */
export interface GameScreenHandle {
  /** Discards input selections after an UNDO confirmed outside a normal dispatch (e.g. retry). */
  resetSelection: () => void;
}
