import type { previewSettlement } from '../../../game/settlement';
import type { GameState, Pot, WinnerSelection } from '../../../game/types';
import { messageFor } from '../model/errorMessages';

// 선택한 승자 기준의 팟별 분배와 플레이어별 지급 결과를 보여준다
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
      <p>카드의 금액은 이번 핸드에 낸 칩입니다. WIN을 누르면 지급됩니다.</p>
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
