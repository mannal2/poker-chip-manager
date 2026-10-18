import type { GameState } from '../game/types';
export interface AppState {
  game: GameState | null;
  status: 'loading' | 'ready' | 'saving' | 'storageError' | 'controlLost' | 'restoreError';
  error: string;
  home: boolean;
}
export const initialAppState: AppState = { game: null, status: 'loading', error: '', home: true };
export function appReducer(state: AppState, update: Partial<AppState>): AppState {
  return { ...state, ...update };
}
