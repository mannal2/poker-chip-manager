import type { GameState } from '../../../game/types';

// 화면 회전 좌석을 저장하는 localStorage 키
/** One key for the whole app: a new tournament simply starts unrotated, like before. */
export const viewSeatKey = 'poker-local:view';

// 이 기기에 저장된 토너먼트의 하단 좌석을 읽는다
/**
 * Bottom seat chosen on this device for a tournament. Falls back to the value older versions
 * saved inside the game settings, then to 0. Blocked storage behaves like an empty one.
 */
export function readViewSeat(tournamentId: string | undefined, legacy = 0): number {
  if (!tournamentId) return 0;
  try {
    const saved = JSON.parse(localStorage.getItem(viewSeatKey) ?? 'null');
    if (saved?.tournamentId === tournamentId && Number.isInteger(saved.seat) && saved.seat >= 0)
      return saved.seat;
  } catch {
    // Unreadable or blocked storage: use the fallback below.
  }
  return legacy;
}

// 토너먼트의 하단 좌석을 이 기기에 저장한다
export function writeViewSeat(tournamentId: string, seat: number) {
  try {
    localStorage.setItem(viewSeatKey, JSON.stringify({ tournamentId, seat }));
  } catch {
    // Rotation still works for this page; it is just not remembered.
  }
}

// 예전 버전이 설정에 저장해 둔 하단 좌석 값을 읽는다
/** Saved games from before the view moved out of the rules keep it in settings. */
export function legacyViewSeat(state: GameState | null): number {
  const seat = (state?.settings as { viewSeat?: unknown } | undefined)?.viewSeat;
  return Number.isInteger(seat) && (seat as number) >= 0 ? (seat as number) : 0;
}
