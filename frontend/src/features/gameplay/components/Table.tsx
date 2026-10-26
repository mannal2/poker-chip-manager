import { PlayerSeat, type CardPlayer } from './PlayerSeat';
import { BoardCards } from './BoardCards';
import { useRef } from 'react';
import { useFitText } from '../../../shared/hooks/useFitText';
import { seatCoordinates } from '../model/seatLayout';
export interface TableSetup {
  drag?: {
    order: string[];
    position?: { id: string; x: number; y: number } | null;
    pressed?: string | null;
    ready?: string | null;
    handlers: (id: string) => React.HTMLAttributes<HTMLElement>;
  };
  editScope?: string;
  onRename?: (id: string, name: string) => boolean | Promise<boolean>;
  onNameEditing?: (id: string, editing: boolean, finish?: () => Promise<boolean>) => void;
  onAdd?: () => void;
  onRemove?: () => void;
  onRotate?: () => void;
}
export function Table({
  players,
  pot,
  phase,
  street,
  viewSeat = 0,
  onSelect,
  onPot,
  potLabel,
  navigation,
  notice,
  busy,
  setup,
  handKey,
}: {
  players: CardPlayer[];
  pot: number;
  phase: string;
  street: string;
  notice?: string;
  busy?: boolean;
  /** Present only while the setup screen is editable; each control is optional per mode. */
  setup?: TableSetup;
  handKey?: string;
  viewSeat?: number;
  onSelect?: (id: string) => void;
  onPot?: () => void;
  potLabel?: string;
  navigation?: { previous: () => void; next: () => void; index: number; count: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFitText(ref, {
    selector: '.card-values>div',
    sizeVar: '--card-text',
    unit: 'var(--u)',
    min: 7,
  });
  const { drag, onAdd, onRemove, onRotate, onRename, onNameEditing, editScope } = setup ?? {};
  return (
    <>
      <div ref={ref} className="table" aria-label="포커 테이블">
        <div className="felt" />
        <div className={`table-center ${phase === 'setup' ? 'setup-center' : ''}`}>
          {phase === 'setup' ? (
            <>
              <div className="count-row setup-count-row">
                {onRemove && (
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
                <div className="pot">
                  <small>TABLE</small>
                  <strong>{players.length}명</strong>
                </div>
                {onAdd && (
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
              {onRotate && (
                <div className="view-actions">
                  <button
                    className="view-rotate"
                    aria-label="화면 기준 한 자리 회전"
                    disabled={busy}
                    onClick={onRotate}
                  >
                    ↻
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="pot-strip">
                {phase !== 'setup' && (
                  <>
                    {navigation && (
                      <button aria-label="이전 팟" onClick={navigation.previous}>
                        ‹
                      </button>
                    )}
                    <button className="pot" onClick={onPot} aria-label="팟 상세">
                      <small>{potLabel || 'POT'}</small>{' '}
                      <strong>{pot.toLocaleString('ko-KR')}</strong>
                      {(navigation || notice) && (
                        <span>
                          {navigation && `${navigation.index}/${navigation.count}`}
                          {notice && ` · ${notice}`}
                        </span>
                      )}
                    </button>
                    {navigation && (
                      <button aria-label="다음 팟" onClick={navigation.next}>
                        ›
                      </button>
                    )}
                  </>
                )}
              </div>

              <BoardCards phase={phase} street={street} handKey={handKey} />
            </>
          )}
        </div>
        {players.map((p, i) => {
          const slot = drag ? drag.order.indexOf(p.id) : i;
          const [x, y] =
            seatCoordinates[players.length][(slot - viewSeat + players.length) % players.length];
          return (
            <PlayerSeat
              key={p.id}
              player={p}
              phase={phase}
              style={{
                left: drag?.position?.id === p.id ? drag.position.x : `${x}%`,
                top: drag?.position?.id === p.id ? drag.position.y : `${y}%`,
                touchAction: drag ? 'none' : undefined,
              }}
              pressed={drag?.pressed === p.id}
              dragReady={drag?.ready === p.id}
              dragging={drag?.position?.id === p.id}
              handlers={drag?.handlers(p.id)}
              busy={busy}
              onSelect={onSelect}
              onRename={onRename}
              onNameEditing={onNameEditing}
              editScope={editScope}
            />
          );
        })}
      </div>
    </>
  );
}
