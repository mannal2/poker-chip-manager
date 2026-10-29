import type { GameState } from '../../../game/types';
import type { LoadEvents } from '../model/eventPages';
import { useEventHistory } from '../hooks/useEventHistory';
import { HistoryPanel } from './HistoryPanel';

export function GameHistoryPanel({
  loadEvents,
  state,
}: {
  loadEvents: LoadEvents;
  state: GameState;
}) {
  const history = useEventHistory(loadEvents, state.tournamentId);
  return <HistoryPanel {...history} players={state.players} />;
}
