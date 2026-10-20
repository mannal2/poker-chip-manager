import { InlineName } from './InlineName';
import { useLayoutEffect, useRef } from 'react';
export interface CardPlayer {
  id: string;
  name: string;
  stack: number;
  contribution: number;
  roles?: string;
  active?: boolean;
  selected?: boolean;
  out?: boolean;
  folded?: boolean;
  pending?: boolean;
  eligible?: boolean;
}
export const seatCoordinates: Record<number, number[][]> = {
  2: [
    [50, 84],
    [50, 16],
  ],
  3: [
    [50, 87],
    [17, 27],
    [83, 27],
  ],
  4: [
    [50, 87],
    [15, 50],
    [50, 13],
    [85, 50],
  ],
  5: [
    [50, 87],
    [15, 65],
    [23, 19],
    [77, 19],
    [85, 65],
  ],
  6: [
    [50, 87],
    [16, 68],
    [16, 31],
    [50, 13],
    [84, 31],
    [84, 68],
  ],
  7: [
    [50, 90],
    [18, 76],
    [14, 48],
    [29, 15],
    [71, 15],
    [86, 48],
    [82, 76],
  ],
  8: [
    [50, 90],
    [19, 79],
    [14, 51],
    [28, 17],
    [72, 17],
    [86, 39],
    [86, 62],
    [81, 81],
  ],
  9: [
    [50, 90],
    [19, 79],
    [14, 58],
    [14, 36],
    [28, 14],
    [72, 14],
    [86, 36],
    [86, 58],
    [81, 79],
  ],
  10: [
    [50, 92],
    [22, 83],
    [14, 62],
    [14, 41],
    [22, 20],
    [50, 8],
    [78, 20],
    [86, 41],
    [86, 62],
    [78, 83],
  ],
};
export function Table({
  players,
  pot,
  phase,
  street,
  viewSeat = 0,
  onSelect,
  onPot,
  potLabel,
  drag,
  navigation,
  notice,
  onAdd,
  onRemove,
  onRotate,
  busy,
  onRename,
  onNameEditing,
  editScope,
  handKey,
}: {
  players: CardPlayer[];
  pot: number;
  phase: string;
  street: string;
  notice?: string;
  onAdd?: () => void;
  onRemove?: () => void;
  onRotate?: () => void;
  busy?: boolean;
  onRename?: (id: string, name: string) => boolean;
  onNameEditing?: (id: string, editing: boolean) => void;
  editScope?: string;
  handKey?: string;
  viewSeat?: number;
  onSelect?: (id: string) => void;
  onPot?: () => void;
  potLabel?: string;
  navigation?: { previous: () => void; next: () => void; index: number; count: number };
  drag?: {
    order: string[];
    position?: { id: string; x: number; y: number } | null;
    pressed?: string | null;
    ready?: string | null;
    handlers: (id: string) => React.HTMLAttributes<HTMLElement>;
  };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLSpanElement>(null),
    previousStage = useRef<string | null>(null);
  const stageKey =
    phase === 'setup'
      ? 'setup'
      : `${handKey ?? ''}/${phase === 'settlement' ? 'settlement' : street}`;
  useLayoutEffect(() => {
    const previous = previousStage.current;
    previousStage.current = stageKey;
    if (
      previous === null ||
      previous === stageKey ||
      stageKey === 'setup' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const label = stageRef.current;
    if (!label) return;
    const style = getComputedStyle(label);
    const color = style.color,
      fontWeight = style.fontWeight;
    const gold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
    const animation = label.animate(
      [
        { color, fontWeight, transform: 'scale(1)', offset: 0 },
        { color: gold, fontWeight: 750, transform: 'scale(1.22)', offset: 0.25 },
        { color, fontWeight, transform: 'scale(1)', offset: 1 },
      ],
      { duration: 520, easing: 'ease-out' },
    );
    return () => animation.cancel();
  }, [stageKey]);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const fit = () =>
      table.querySelectorAll<HTMLElement>('.card-values>div').forEach((cell) => {
        let size = 11;
        cell.style.fontSize = `calc(${size} * var(--u))`;
        while (cell.scrollWidth > cell.clientWidth && size > 7) {
          size -= 0.25;
          cell.style.fontSize = `calc(${size} * var(--u))`;
        }
      });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(table);
    return () => observer.disconnect();
  });
  return (
    <div ref={ref} className="table" aria-label="포커 테이블">
      <div className="felt" />
      <div className={`table-center ${phase === 'setup' ? 'setup-center' : ''}`}>
        <div className={`count-row ${phase === 'setup' ? 'setup-count-row' : ''}`}>
          {phase === 'setup' && onRemove && (
            <button
              className="count-control"
              aria-label="참가자 삭제"
              disabled={busy || players.length <= 2}
              data-unavailable={players.length <= 2}
              onClick={onRemove}
            >
              −
            </button>
          )}
          <button className="pot" onClick={onPot} aria-label="팟 상세">
            <small>{phase === 'setup' ? 'TABLE' : potLabel || 'POT'}</small>
            <strong>
              {phase === 'setup' ? `${players.length}명` : pot.toLocaleString('ko-KR')}
            </strong>
            <span ref={stageRef} className="stage-label">
              {phase === 'settlement' ? '승자 선택' : phase === 'setup' ? '' : street}
              {navigation && (
                <>
                  {' '}
                  · {navigation.index}/{navigation.count}
                </>
              )}
              {notice && <> · {notice}</>}
            </span>
          </button>
          {phase === 'setup' && onAdd && (
            <button
              className="count-control"
              aria-label="참가자 추가"
              disabled={busy || players.length >= 10}
              data-unavailable={players.length >= 10}
              onClick={onAdd}
            >
              +
            </button>
          )}
        </div>
        {(onRotate || navigation) && (
          <div className="view-actions">
            {navigation && (
              <button aria-label="이전 팟" onClick={navigation.previous}>
                ‹
              </button>
            )}
            {phase === 'setup' && onRotate && (
              <button
                className="view-rotate"
                aria-label="화면 기준 한 자리 회전"
                disabled={busy}
                onClick={onRotate}
              >
                ↻
              </button>
            )}
            {navigation && (
              <button aria-label="다음 팟" onClick={navigation.next}>
                ›
              </button>
            )}
          </div>
        )}
      </div>
      {players.map((p, i) => {
        const slot = drag ? drag.order.indexOf(p.id) : i;
        const [x, y] =
          seatCoordinates[players.length][(slot - viewSeat + players.length) % players.length];
        const Card = onRename ? 'div' : 'button';
        const Values = onRename ? 'button' : 'div';
        return (
          <Card
            key={p.id}
            type="button"
            role={onRename ? 'group' : undefined}
            data-player={p.id}
            className={`seat ${p.active ? 'active' : ''} ${p.selected ? 'selected' : ''} ${p.out || p.folded ? 'out' : ''} ${drag?.pressed === p.id ? 'pressing' : ''} ${drag?.ready === p.id ? 'drag-ready' : ''} ${drag?.position?.id === p.id ? 'dragging' : ''}`}
            style={{
              left: drag?.position?.id === p.id ? drag.position.x : `${x}%`,
              top: drag?.position?.id === p.id ? drag.position.y : `${y}%`,
              touchAction: drag ? 'none' : undefined,
            }}
            aria-label={`${p.name}${p.active ? ' 현재 차례' : ''}${p.folded ? ' 폴드' : ''}${p.out ? ' 탈락' : ''}`}
            aria-pressed={phase === 'settlement' ? !!p.selected : undefined}
            aria-disabled={phase === 'settlement' && !p.eligible}
            onContextMenu={(e) => {
              if (!(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]'))
                e.preventDefault();
            }}
            onClick={() => onSelect?.(p.id)}
            {...drag?.handlers(p.id)}
          >
            {p.roles && <span className="badge">{p.roles}</span>}
            <div className="name">
              {onRename ? (
                <InlineName
                  key={p.id + ':' + editScope}
                  name={p.name}
                  busy={!!busy}
                  onSave={(name) => onRename(p.id, name)}
                  onEditing={(editing) => onNameEditing?.(p.id, editing)}
                />
              ) : (
                p.name
              )}
            </div>
            <Values
              className="card-values"
              type={onRename ? 'button' : undefined}
              aria-label={onRename ? p.name + ' 첫 딜러 선택' : undefined}
            >
              <div
                className={`bet ${p.pending ? 'pending' : ''}`}
                aria-label={`핸드 누적액 ${p.contribution}`}
              >
                {p.contribution.toLocaleString('ko-KR')}
              </div>
              <div className="stack" aria-label={`남은 칩 ${p.stack}`}>
                {p.stack.toLocaleString('ko-KR')}
              </div>
            </Values>
            {p.active && <span className="turn" />}
          </Card>
        );
      })}
    </div>
  );
}
