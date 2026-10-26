export function BetControls({
  call = 0,
  canUndo = false,
  onAction = () => {},
  busy = false,
  submitAllowed = true,
  maxAdditional = Infinity,
  draftAmount = 0,
}: {
  call?: number;
  canUndo?: boolean;
  busy?: boolean;
  submitAllowed?: boolean;
  maxAdditional?: number;
  draftAmount?: number;
  onAction?: (action: string, amount?: number) => void;
}) {
  return (
    <>
      <div className="bet-top">
        <button
          aria-disabled={!canUndo || busy}
          data-unavailable={!canUndo}
          onClick={() => onAction('UNDO')}
        >
          취소
        </button>
        <button aria-disabled={busy} onClick={() => onAction(call ? 'CALL' : 'CHECK')}>
          {call ? `콜 ${call.toLocaleString('ko-KR')}` : '체크'}
        </button>
        <button
          aria-disabled={busy || call === 0}
          data-unavailable={call === 0}
          onClick={() => {
            if (call > 0) onAction('FOLD');
          }}
        >
          폴드
        </button>
        <button aria-disabled={busy} onClick={() => onAction('DRAFT_ALL')}>
          올인
        </button>
      </div>
      <div className="bet-bottom">
        {[5, 10, 50, 100].map((n) => (
          <button
            key={n}
            className="chip"
            data-chip={n}
            aria-label={`${n}칩 추가`}
            aria-disabled={busy || draftAmount + n > maxAdditional}
            data-unavailable={draftAmount + n > maxAdditional}
            onClick={() => onAction('CHIP', n)}
          >
            <span>{n}</span>
          </button>
        ))}
      </div>
      <div className="bet-confirm">
        <button
          aria-disabled={busy}
          aria-label="미확정 입력 초기화"
          onClick={() => onAction('CLEAR')}
        >
          CLEAR
        </button>
        <button
          className="primary"
          aria-disabled={busy || !submitAllowed}
          data-unavailable={!submitAllowed}
          onClick={() => onAction('SUBMIT')}
        >
          BET
        </button>
      </div>
    </>
  );
}
