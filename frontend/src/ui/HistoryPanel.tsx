import { useEffect, useState } from 'react';
import type { LocalRepository } from '../local/repository';
import type { GameEvent, GameState } from '../game/types';
import { historyRows } from './history';
export function HistoryPanel({
  repository,
  state,
}: {
  repository: LocalRepository;
  state: GameState;
}) {
  const [events, setEvents] = useState<GameEvent[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [reversed, setReversed] = useState(false),
    [limit, setLimit] = useState(50);
  useEffect(() => {
    let active = true;
    // Read chronologically in bounded batches so UNDO is resolved across page boundaries.
    async function load() {
      const all: GameEvent[] = [];
      let after = 0;
      try {
        while (active) {
          const batch = await repository.readEvents(state.tournamentId, after, 100);
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
  }, [repository, state.tournamentId]);
  const rows = historyRows(events, state.players);
  if (reversed) rows.reverse();
  const shown = rows.slice(0, limit);
  return (
    <>
      <div className="history-toolbar">
        <h2>현재 토너먼트 기록</h2>
        <button
          onClick={() => {
            setReversed(!reversed);
            setLimit(50);
          }}
          aria-label={reversed ? '오래된순 ↑' : '최신순 ↓'}
        >
          {reversed ? '오래된순 ↑' : '최신순 ↓'}
        </button>
      </div>
      {error && <p role="alert">기록을 읽을 수 없습니다: {error}</p>}
      <ol className="history-list">
        {shown.map((row) => (
          <li
            key={row.id}
            data-kind={row.kind}
            className={row.kind === 'action' ? undefined : 'history-' + row.kind}
          >
            {row.kind === 'action' ? row.text : <strong>{row.text}</strong>}
          </li>
        ))}
      </ol>
      {loading && <p role="status">기록 불러오는 중…</p>}
      {rows.length > limit && <button onClick={() => setLimit(limit + 50)}>더 보기</button>}
      {!loading && !error && !rows.length && <p>아직 기록이 없습니다.</p>}
    </>
  );
}
