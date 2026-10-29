import { useState } from 'react';
import type { GameEvent, Player } from '../../../game/types';
import { historyRows } from '../model/history';
export function HistoryPanel({
  events,
  players,
  error,
  loading,
}: {
  events: GameEvent[];
  players: Player[];
  error: string;
  loading: boolean;
}) {
  const [reversed, setReversed] = useState(false),
    [limit, setLimit] = useState(50);
  const rows = historyRows(events, players);
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
