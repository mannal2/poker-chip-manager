import type { GameState } from '../../../game/types';

/** One key for the whole app: a new tournament simply starts unrotated, like before. */
export const viewSeatKey = 'poker-local:view';

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

export function writeViewSeat(tournamentId: string, seat: number) {
  try {
    localStorage.setItem(viewSeatKey, JSON.stringify({ tournamentId, seat }));
  } catch {
    // Rotation still works for this page; it is just not remembered.
  }
}

/** Saved games from before the view moved out of the rules keep it in settings. */
export function legacyViewSeat(state: GameState | null): number {
  const seat = (state?.settings as { viewSeat?: unknown } | undefined)?.viewSeat;
  return Number.isInteger(seat) && (seat as number) >= 0 ? (seat as number) : 0;
}
