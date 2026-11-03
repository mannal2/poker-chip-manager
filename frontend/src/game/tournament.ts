import { validateSettings, type GameSettings } from './settings';
import type { GameState, TransitionContext } from './types';

// 설정을 검증하고 플레이어가 배치된 설정 단계의 초기 상태를 만든다
export function createTournament(settings: GameSettings, c: TransitionContext): GameState {
  const v = validateSettings(settings);
  if (!v.ok) throw Error(v.code);
  return {
    tournamentId: c.id,
    version: 0,
    status: 'setup',
    settings: v.settings,
    initialTotal: settings.initial * settings.names.length,
    setupOrder: settings.names.map((_, i) => `p${i}`),
    players: v.settings.names.map((name, i) => ({
      id: `p${i}`,
      name,
      stack: settings.initial,
      eliminated: false,
      folded: false,
      B: 0,
      H: 0,
      actedAt: null,
      reopenAt: 0,
    })),
    hand: null,
    pot: 0,
    pendingBlinds: null,
    undo: null,
  };
}
