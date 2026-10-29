import type { CSSProperties, HTMLAttributes } from 'react';
import { InlineName } from './InlineName';

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

// Shown only when the full amount cannot fit even at the smallest font. Rounds down so a
// shortened amount never claims more chips than the player has.
function shortChips(value: number) {
  const [unit, label] = value >= 1e8 ? [1e8, '억'] : value >= 1e4 ? [1e4, '만'] : [1, ''];
  if (unit === 1) return undefined;
  const amount = Math.floor((value / unit) * 10) / 10;
  return amount.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + label;
}

export function PlayerSeat({
  player: p,
  phase,
  style,
  pressed,
  dragReady,
  dragging,
  handlers,
  busy,
  onSelect,
  onRename,
  onNameEditing,
  editScope,
}: {
  player: CardPlayer;
  phase: string;
  style: CSSProperties;
  pressed?: boolean;
  dragReady?: boolean;
  dragging?: boolean;
  handlers?: HTMLAttributes<HTMLElement>;
  busy?: boolean;
  onSelect?: (id: string) => void;
  onRename?: (id: string, name: string) => boolean | Promise<boolean>;
  onNameEditing?: (id: string, editing: boolean, finish?: () => Promise<boolean>) => void;
  editScope?: string;
}) {
  const Card = onRename ? 'div' : 'button';
  const Values = onRename ? 'button' : 'div';
  return (
    <Card
      type="button"
      role={onRename ? 'group' : undefined}
      data-player={p.id}
      className={`seat ${p.active ? 'active' : ''} ${p.selected ? 'selected' : ''} ${p.out || p.folded ? 'out' : ''} ${pressed ? 'pressing' : ''} ${dragReady ? 'drag-ready' : ''} ${dragging ? 'dragging' : ''}`}
      style={style}
      aria-label={`${p.name}${p.active ? ' 현재 차례' : ''}${p.folded ? ' 폴드' : ''}${p.out ? ' 탈락' : ''}`}
      aria-pressed={phase === 'settlement' ? !!p.selected : undefined}
      aria-disabled={phase === 'settlement' && !p.eligible}
      onContextMenu={(e) => {
        if (!(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]'))
          e.preventDefault();
      }}
      onClick={() => onSelect?.(p.id)}
      {...handlers}
    >
      {p.roles && <span className="badge">{p.roles}</span>}
      <div className="name">
        {onRename ? (
          <InlineName
            key={p.id + ':' + editScope}
            name={p.name}
            busy={!!busy}
            onSave={(name) => onRename(p.id, name)}
            onEditing={(editing, finish) => onNameEditing?.(p.id, editing, finish)}
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
          data-short={shortChips(p.contribution)}
        >
          <span>{p.contribution.toLocaleString('ko-KR')}</span>
        </div>
        <div className="stack" aria-label={`남은 칩 ${p.stack}`} data-short={shortChips(p.stack)}>
          <span>{p.stack.toLocaleString('ko-KR')}</span>
        </div>
      </Values>
      {p.active && <span className="turn" />}
    </Card>
  );
}
