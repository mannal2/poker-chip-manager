import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useChipMotion } from '../../gameplay/hooks/useChipMotion';
import { eventsToTransfers } from '../../gameplay/model/eventTransfers';
import type { OnlineController } from '../session/onlineController';
import type { RoomSnapshot } from '../api/types';

// 확정 이벤트의 이전 DOM 좌표를 준비하고 새 상태가 렌더링된 뒤 칩을 이동한다
export function useOnlineChipMotion(
  screen: RefObject<HTMLElement | null>,
  controller: OnlineController,
  snapshot: RoomSnapshot,
) {
  const { prepare, play, clear } = useChipMotion(screen, snapshot.tournamentId ?? snapshot.roomId);
  const pending = useRef<ReturnType<typeof prepare>>(null);
  useEffect(() => {
    const unsubscribe = controller.onConfirmed(({ events }) => {
      if (events.some((event) => event.type === 'UNDO')) {
        clear();
        pending.current = null;
      } else pending.current = prepare(eventsToTransfers(events));
    });
    return () => {
      unsubscribe();
      pending.current = null;
      clear();
    };
  }, [controller, prepare, clear]);
  useLayoutEffect(() => {
    play(pending.current);
    pending.current = null;
  }, [snapshot, play]);
}
