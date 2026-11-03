import type { GameEvent } from '../../../game/types';

// 토너먼트 이벤트를 페이지 단위로 읽어 오는 함수 형식
/** Reads a tournament's events after a sequence number (local: IndexedDB, online: REST). */
export type LoadEvents = (
  tournamentId: string,
  after: number,
  limit: number,
) => Promise<GameEvent[]>;

// 이벤트를 페이지 단위로 끝까지 읽어 전체 목록을 만든다
/**
 * Reads every event in chronological pages so UNDO can be resolved across page boundaries.
 * Returns null when the caller stops being interested part way through.
 */
export async function readAllEvents(
  load: LoadEvents,
  tournamentId: string,
  isActive: () => boolean = () => true,
  pageSize = 100,
): Promise<GameEvent[] | null> {
  const all: GameEvent[] = [];
  let after = 0;
  while (isActive()) {
    const batch = await load(tournamentId, after, pageSize);
    all.push(...batch);
    if (batch.length < pageSize) return isActive() ? all : null;
    after = batch.at(-1)!.sequence!;
  }
  return null;
}
