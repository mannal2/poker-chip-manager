// 베팅 조작부에서 발생하는 버튼 입력 종류
/** Draft inputs (CHIP, CLEAR, DRAFT_ALL, SUBMIT) and direct betting commands. */
export type BetAction = 'CHECK' | 'CALL' | 'FOLD' | 'DRAFT_ALL' | 'CHIP' | 'CLEAR' | 'SUBMIT';
// 취소/체크·콜/폴드/올인과 칩 버튼으로 이뤄진 베팅 조작부
export function BetControls({
  call = 0,
  canUndo = false,
  onAction = () => {},
  onUndo = () => {},
  busy = false,
  canBet = true,
  submitAllowed = true,
  maxAdditional = Infinity,
  draftAmount = 0,
}: {
  call?: number;
  canUndo?: boolean;
  busy?: boolean;
  canBet?: boolean;
  submitAllowed?: boolean;
  maxAdditional?: number;
  draftAmount?: number;
  onAction?: (action: BetAction, amount?: number) => void;
  onUndo?: () => void;
}) {
  const bettingLocked = busy || !canBet;
  return (
    <>
      <div className="bet-top">
        <button aria-disabled={!canUndo || busy} data-unavailable={!canUndo} onClick={onUndo}>
          취소
        </button>
        <button aria-disabled={bettingLocked} onClick={() => onAction(call ? 'CALL' : 'CHECK')}>
          {call ? `콜 ${call.toLocaleString('ko-KR')}` : '체크'}
        </button>
        <button
          aria-disabled={bettingLocked || call === 0}
          data-unavailable={call === 0}
          onClick={() => {
            if (call > 0) onAction('FOLD');
          }}
        >
          폴드
        </button>
        <button aria-disabled={bettingLocked} onClick={() => onAction('DRAFT_ALL')}>
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
            aria-disabled={bettingLocked || draftAmount + n > maxAdditional}
            data-unavailable={draftAmount + n > maxAdditional}
            onClick={() => onAction('CHIP', n)}
          >
            <span>{n}</span>
          </button>
        ))}
      </div>
      <div className="bet-confirm">
        <button
          aria-disabled={bettingLocked}
          aria-label="미확정 입력 초기화"
          onClick={() => onAction('CLEAR')}
        >
          CLEAR
        </button>
        <button
          className="primary"
          aria-disabled={bettingLocked || !submitAllowed}
          data-unavailable={!submitAllowed}
          onClick={() => onAction('SUBMIT')}
        >
          BET
        </button>
      </div>
    </>
  );
}
