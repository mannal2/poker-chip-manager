import { useState } from 'react';
import type { GameState } from '../game/types';
import { validChips } from '../game/settings';
export function BlindSettings({
  state,
  busy,
  onSave,
}: {
  state: GameState;
  busy: boolean;
  onSave: (sb: number, bb: number) => void;
}) {
  const current = state.pendingBlinds ?? state.hand!;
  const [sb, setSB] = useState(String(current.sb)),
    [bb, setBB] = useState(String(current.bb)),
    [error, setError] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        if (!validChips(Number(sb)) || !validChips(Number(bb)) || Number(sb) >= Number(bb)) {
          setError('5 단위, 0 < SB < BB (최대 1,000,000)로 설정하세요.');
          return;
        }
        onSave(Number(sb), Number(bb));
      }}
    >
      <div className="setup-fields blind-fields">
        <label>
          <input
            aria-label="다음 SB"
            inputMode="numeric"
            value={sb}
            onChange={(e) => setSB(e.target.value)}
          />
          <span>SB</span>
        </label>
        <label>
          <input
            aria-label="다음 BB"
            inputMode="numeric"
            value={bb}
            onChange={(e) => setBB(e.target.value)}
          />
          <span>BB</span>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button className="primary blind-reserve" aria-disabled={busy}>
        예약
      </button>
    </form>
  );
}
