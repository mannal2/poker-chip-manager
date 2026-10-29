import type { GameEvent } from '../../../game/types';

/** Reads a tournament's events after a sequence number (local: IndexedDB, online: REST). */
export type LoadEvents = (
  tournamentId: string,
  after: number,
  limit: number,
) => Promise<GameEvent[]>;

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
