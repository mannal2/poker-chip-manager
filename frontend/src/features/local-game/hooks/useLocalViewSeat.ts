import { useEffect, useState } from 'react';
import type { GameState } from '../../../game/types';
import { legacyViewSeat, readViewSeat, viewSeatKey, writeViewSeat } from '../model/viewSeatStore';

// 화면 하단에 그릴 좌석을 토너먼트별로 기억하고 회전시키는 훅
/** Local screen rotation: which table slot is drawn at the bottom, remembered per tournament. */
export function useLocalViewSeat(state: GameState | null) {
  const tournamentId = state?.tournamentId;
  const count = state?.players.length ?? 0;
  const legacy = legacyViewSeat(state);
  const [stored, setView] = useState(() => ({
    tournamentId,
    seat: readViewSeat(tournamentId, legacy),
  }));
  let view = stored;
  if (view.tournamentId !== tournamentId) {
    view = { tournamentId, seat: readViewSeat(tournamentId, legacy) };
    setView(view);
  }
  // Removing players keeps the bottom slot in range, as the old settings validation required.
  const seat = count ? Math.min(view.seat, count - 1) : 0;
  useEffect(() => {
    if (!tournamentId) return;
    if (seat !== view.seat) setView({ tournamentId, seat });
    // Also persists a seed taken from old settings, which the next settings save drops.
    if (seat !== view.seat || readViewSeat(tournamentId, -1) === -1)
      writeViewSeat(tournamentId, seat);
  }, [tournamentId, seat, view.seat]);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === viewSeatKey)
        setView({ tournamentId, seat: readViewSeat(tournamentId, legacy) });
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [tournamentId, legacy]);
  // 화면 기준 좌석을 한 자리 회전시키고 저장한다
  function rotate() {
    if (!tournamentId || !count) return;
    const next = (seat + count - 1) % count;
    setView({ tournamentId, seat: next });
    writeViewSeat(tournamentId, next);
  }
  return { viewSeat: seat, rotate };
}
