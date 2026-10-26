import type { GameState } from '../../../game/types';
export interface AppState {
  game: GameState | null;
  status: 'loading' | 'ready' | 'saving' | 'storageError' | 'controlLost' | 'restoreError';
  error: string;
  home: boolean;
}
export const initialAppState: AppState = { game: null, status: 'loading', error: '', home: true };
/** Shallow-merges a partial screen update; the reducer has no actions or side effects. */
export function mergeAppState(state: AppState, update: Partial<AppState>): AppState {
  return { ...state, ...update };
}
