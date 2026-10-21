export function SettlementPanel({
  count,
  busy,
  onWin,
  canUndo = false,
  onUndo = () => {},
}: {
  count: number;
  busy: boolean;
  onWin: () => void;
  canUndo?: boolean;
  onUndo?: () => void;
}) {
  return (
    <div className="settlement-controls">
      <div className="settlement-count" aria-live="polite">
        {count > 0 ? `${count}명 선택` : '승자 선택'}
      </div>
      <div className="bet-top">
        <button aria-disabled={busy || !canUndo} data-unavailable={!canUndo} onClick={onUndo}>
          취소
        </button>
        <button className="primary" aria-disabled={busy} onClick={onWin}>
          WIN
        </button>
      </div>
    </div>
  );
}
