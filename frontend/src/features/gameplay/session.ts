import type { GameSettings } from '../../game/settings';
import type { GameCommand, GameState } from '../../game/types';
import type { useSeatDrag } from './hooks/useSeatDrag';

/** Mode-provided state and command channel that the shared game screen is assembled from. */
export interface GameSession {
  state: GameState;
  busy: boolean;
  /** Control scope from the mode (local: lease generation); undefined disables betting drafts. */
  scope: string | number | undefined;
  /** Returns the reason the screen cannot accept input now, or null when it can. */
  guard: () => string | null;
  run: (action: () => Promise<void>) => Promise<void>;
  dispatch: (command: GameCommand) => Promise<boolean>;
  notify: (message: string) => void;
}

/** Setup editing callbacks the mode wires to the table and setup form. */
export interface SetupControls {
  scope: string;
  drag: ReturnType<typeof useSeatDrag>;
  saveSettings: (settings: GameSettings) => void;
  changeCount: (add: boolean) => void;
  onNameEditing: (id: string, editing: boolean, finish?: () => Promise<boolean>) => void;
  rename?: (id: string, name: string) => boolean | Promise<boolean>;
  rotate?: () => void;
  start: (settings: GameSettings) => void;
}

export type GameDialog = 'payout' | 'menu' | 'history' | 'blinds';

/** Imperative hooks for mode events that happen outside the screen's own commands. */
export interface GameScreenHandle {
  /** Discards input selections after an UNDO confirmed outside a normal dispatch (e.g. retry). */
  resetSelection: () => void;
}
