import { useEffect, useRef, useState } from 'react';
import type { GameEvent } from '../../../game/types';
import { readAllEvents, type LoadEvents } from '../model/eventPages';

/** Loads the whole event history once per tournament; loadEvents may change identity freely. */
export function useEventHistory(loadEvents: LoadEvents, tournamentId: string) {
  const [events, setEvents] = useState<GameEvent[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const load = useRef(loadEvents);
  useEffect(() => {
    load.current = loadEvents;
  });
  useEffect(() => {
    let active = true;
    readAllEvents(
      (...args) => load.current(...args),
      tournamentId,
      () => active,
    ).then(
      (all) => {
        if (!all) return;
        setEvents(all);
        setLoading(false);
      },
      (e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [tournamentId]);
  return { events, error, loading };
}
