import type { GameState } from '../../../game/types';
import type { LocalRepository } from '../storage/repository';
import { HistoryPanel } from '../../gameplay/components/HistoryPanel';
import { useLocalHistory } from '../hooks/useLocalHistory';

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
