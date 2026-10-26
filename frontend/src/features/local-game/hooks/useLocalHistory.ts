import { useEffect, useState } from 'react';
import type { GameEvent } from '../../../game/types';
import type { LocalRepository } from '../storage/repository';

export function useLocalHistory(repository: LocalRepository, tournamentId: string) {
  const [events, setEvents] = useState<GameEvent[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    // Read chronologically in bounded batches so UNDO is resolved across page boundaries.
    async function load() {
      const all: GameEvent[] = [];
      let after = 0;
      try {
        while (active) {
          const batch = await repository.readEvents(tournamentId, after, 100);
          all.push(...batch);
          if (batch.length < 100) break;
          after = batch.at(-1)!.sequence!;
        }
        if (active) {
          setEvents(all);
          setLoading(false);
        }
      } catch (e) {
        if (active) {
          setError(String(e));
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [repository, tournamentId]);
  return { events, error, loading };
}
