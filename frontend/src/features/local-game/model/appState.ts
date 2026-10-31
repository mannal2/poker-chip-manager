import type { GameState } from '../../../game/types';
// 로컬 앱 화면의 게임, 진행 상태, 오류, 홈 여부
export interface AppState {
  game: GameState | null;
  status: 'loading' | 'ready' | 'saving' | 'storageError' | 'controlLost' | 'restoreError';
  error: string;
  home: boolean;
}
// 앱 시작 시의 초기 화면 상태
export const initialAppState: AppState = { game: null, status: 'loading', error: '', home: true };
// 부분 갱신을 현재 상태에 얕게 합친다
/** Shallow-merges a partial screen update; the reducer has no actions or side effects. */
export function mergeAppState(state: AppState, update: Partial<AppState>): AppState {
  return { ...state, ...update };
}
