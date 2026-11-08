import { PlayerSeat, type CardPlayer } from './PlayerSeat';
import { BoardCards } from './BoardCards';
import type { GameSession } from '../session';
import { useRef } from 'react';
import { useFitText } from '../../../shared/hooks/useFitText';
import { seatCoordinates } from '../model/seatLayout';
// 온라인 관리 작업에서 선택할 수 있는 카드와 확인 중인 카드를 표시한다
export interface CardSelection {
  eligibleIds: ReadonlySet<string>;
  selectedId?: string;
  onSelect: (id: string) => void;
}
// 설정 단계에서만 쓰는 테이블 편집 조작 모음
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
  canRename?: (id: string) => boolean;
  onNameEditing?: (id: string, editing: boolean, finish?: () => Promise<boolean>) => void;
  onAdd?: () => void;
  onRemove?: () => void;
  onRotate?: () => void;
}
// 팟, 공용 카드, 플레이어 좌석을 배치해 그리는 포커 테이블
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
  boardReveal,
  selection,
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
  boardReveal?: GameSession['boardReveal'];
  selection?: CardSelection;
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
  const { drag, onAdd, onRemove, onRotate, onRename, canRename, onNameEditing, editScope } =
    (selection ? undefined : setup) ?? {};
  return (
    <>
      <div
        ref={ref}
        className={`table${selection ? ' selecting-player' : ''}`}
        aria-label="포커 테이블"
      >
        <div className="felt" />
        <div className={`table-center ${phase === 'setup' ? 'setup-center' : ''}`}>
          {phase === 'setup' ? (
            <>
              <div className="count-row setup-count-row">
                {onRemove && (
                  <button
                    className="count-control"
                    aria-label="플레이어 삭제"
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
                    aria-label="플레이어 추가"
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
                    aria-label="자리 돌리기"
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

              <BoardCards
                phase={phase}
                street={street}
                handKey={handKey}
                boardReveal={boardReveal}
              />
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
              targetState={
                selection
                  ? !selection.eligibleIds.has(p.id)
                    ? 'disabled'
                    : selection.selectedId === p.id
                      ? 'selected'
                      : 'eligible'
                  : undefined
              }
              onSelect={
                selection
                  ? (id) => {
                      if (!busy && selection.eligibleIds.has(id)) selection.onSelect(id);
                    }
                  : onSelect
              }
              onRename={!canRename || canRename(p.id) ? onRename : undefined}
              onNameEditing={onNameEditing}
              editScope={editScope}
            />
          );
        })}
      </div>
    </>
  );
}
