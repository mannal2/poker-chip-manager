import type { previewSettlement } from '../../../game/settlement';
import type { GameState, Pot, WinnerSelection } from '../../../game/types';
import { messageFor } from '../model/errorMessages';

export function PayoutPreview({
  state,
  pots,
  winners,
  preview,
}: {
  state: GameState;
  pots: Pot[];
  winners: WinnerSelection;
  preview: ReturnType<typeof previewSettlement> | null;
}) {
  return (
    <>
      <p>테이블의 누적액은 현재 핸드 납부액입니다. WIN 저장 후 지급됩니다.</p>
      {pots.map((p, i) => (
        <p key={p.id}>
          {i === 0 ? '메인 팟' : '사이드 팟 ' + i}: {p.amount.toLocaleString('ko-KR')} ·{' '}
          {(winners[p.id] ?? [])
            .map((id) => state.players.find((p) => p.id === id)!.name)
            .join(', ') || '선택 필요'}
        </p>
      ))}
      {preview?.allocations?.map((a, i) => (
        <div key={a.potId}>
          <p>
            {i === 0 ? '메인' : '사이드 ' + i} 분배:{' '}
            {Object.entries(a.payouts)
              .map(
                ([id, n]) =>
                  state.players.find((p) => p.id === id)!.name + ' ' + n.toLocaleString('ko-KR'),
              )
              .join(', ')}
          </p>
          {a.remainderRecipients.length > 0 && (
            <p>
              남는 5칩:{' '}
              {a.remainderRecipients
                .map((id) => state.players.find((p) => p.id === id)!.name)
                .join(', ')}
            </p>
          )}
        </div>
      ))}
      {preview?.ok ? (
        state.players.map((p) => (
          <p key={p.id}>
            {p.name}: +{preview.payouts[p.id].toLocaleString('ko-KR')} →{' '}
            {(p.stack + preview.payouts[p.id]).toLocaleString('ko-KR')}
          </p>
        ))
      ) : (
        <p role="alert">{preview?.error && messageFor(preview.error)}</p>
      )}
    </>
  );
}
