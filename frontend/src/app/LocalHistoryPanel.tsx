import type { GameState } from '../game/types';
import type { LocalRepository } from '../local/repository';
import { HistoryPanel } from '../ui/HistoryPanel';
import { useLocalHistory } from './useLocalHistory';

export function LocalHistoryPanel({
  repository,
  state,
}: {
  repository: LocalRepository;
  state: GameState;
}) {
  const history = useLocalHistory(repository, state.tournamentId);
  return <HistoryPanel {...history} players={state.players} />;
}
