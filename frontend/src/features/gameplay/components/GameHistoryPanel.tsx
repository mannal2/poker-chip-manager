import type { GameState } from '../../../game/types';
import type { LoadEvents } from '../model/eventPages';
import { useEventHistory } from '../hooks/useEventHistory';
import { HistoryPanel } from './HistoryPanel';

// 현재 토너먼트의 이벤트를 불러와 기록 패널에 넘긴다
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
