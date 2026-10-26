import type { GameCommand, GameState, LegalActions } from '../../game/types';
import type { useSetupEditing } from './hooks/useSetupEditing';
import type { GameCapabilities } from './model/capabilities';

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

/** Mode-provided state and command channel that the shared game screen is assembled from. */
export interface GameSession {
  state: GameState;
  busy: boolean;
  /** Viewer permissions; storage/server checks still decide the final result. */
  capabilities: GameCapabilities;
  /** Allowed betting actions and amounts (local: getLegalActions, online: server response). */
  legal: LegalActions | null;
  /** Control scope from the mode (local: lease generation); undefined disables betting drafts. */
  scope: string | number | undefined;
  /** Returns the reason the screen cannot accept input now, or null when it can. */
  guard: () => string | null;
  run: (action: () => Promise<void>) => Promise<void>;
  dispatch: (command: GameCommand) => Promise<boolean>;
  notify: (message: string) => void;
}

/** Shared setup editing plus optional mode extras (local: player count and screen rotation). */
export type SetupControls = ReturnType<typeof useSetupEditing> & {
  changeCount?: (add: boolean) => void;
  rotate?: () => void;
};

export type GameDialog = 'payout' | 'menu' | 'history' | 'blinds';

/** Imperative hooks for mode events that happen outside the screen's own commands. */
export interface GameScreenHandle {
  /** Discards input selections after an UNDO confirmed outside a normal dispatch (e.g. retry). */
  resetSelection: () => void;
}
