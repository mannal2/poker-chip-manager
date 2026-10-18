export function SettlementPanel({
  count,
  busy,
  onWin,
}: {
  count: number;
  busy: boolean;
  onWin: () => void;
}) {
  return (
    <>
      <div className="settlement-count" aria-live="polite">
        {count}명 선택
      </div>
      <button className="primary" aria-disabled={busy} onClick={onWin}>
        WIN
      </button>
    </>
  );
}
