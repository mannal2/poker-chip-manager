export function GameHeader({
  handNumber,
  sb,
  bb,
  pendingBlinds,
  canEditBlinds,
  onHistory,
  onBlinds,
  onMenu,
}: {
  handNumber: number;
  sb: number;
  bb: number;
  pendingBlinds: { sb: number; bb: number } | null;
  canEditBlinds: boolean;
  onHistory: () => void;
  onBlinds: () => void;
  onMenu: () => void;
}) {
  return (
    <header className="meta">
      <div className="meta-info">
        <button className="meta-link" aria-label="현재 토너먼트 기록" onClick={onHistory}>
          HAND <strong>{String(handNumber).padStart(2, '0')}</strong>
        </button>
        <button
          id="blinds"
          className="meta-link"
          aria-label="다음 핸드 블라인드 설정"
          disabled={!canEditBlinds}
          onClick={onBlinds}
        >
          <strong>
            {sb.toLocaleString('ko-KR')} / {bb.toLocaleString('ko-KR')}
          </strong>
          {pendingBlinds && (
            <span className="pending-blinds">
              {' '}
              → {pendingBlinds.sb.toLocaleString('ko-KR')} /{' '}
              {pendingBlinds.bb.toLocaleString('ko-KR')}
            </span>
          )}
        </button>
      </div>
      <button id="menu" aria-label="관리 메뉴" onClick={onMenu}>
        ☰
      </button>
    </header>
  );
}
