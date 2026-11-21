import { SeatField } from './SeatField';
import type { SeatOption } from '../model/buyIn';

// 첫 카드 전까지 취소할 수 있는 대기 중인 바이인 목록
export function WaitingBuyIns({
  waiting,
  busy,
  onCancel,
}: {
  waiting: { id: string; name: string }[];
  busy: boolean;
  onCancel: (playerId: string) => void;
}) {
  return (
    <section>
      <h3>대기 중인 바이인</h3>
      <ul className="waiting">
        {waiting.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <button disabled={busy} onClick={() => onCancel(p.id)}>
              바이인 취소
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// 재입장은 원래 자리로 돌아가고, 원래 자리를 다른 플레이어가 차지했을 때만 자리를 고르게 한다
export function ReentrySeat({
  seated,
  options,
  seat,
  busy,
  onChange,
}: {
  seated: boolean;
  options: SeatOption[];
  seat: SeatOption | undefined;
  busy: boolean;
  onChange: (key: string) => void;
}) {
  if (seated) return <p className="hint">원래 자리로 돌아갑니다.</p>;
  return (
    <>
      <p className="hint">원래 자리에 다른 플레이어가 앉아 있습니다. 앉을 자리를 골라 주세요.</p>
      <SeatField options={options} seat={seat} busy={busy} onChange={onChange} />
    </>
  );
}

// 바이인으로 받는 시작 칩과 참여 시점을 안내한다
export function BuyInGuide({ initial }: { initial: number }) {
  return (
    <p className="guide">
      시작 칩 {initial.toLocaleString('ko-KR')}을 받고 다음 핸드부터 참여합니다.
      버튼과 스몰 블라인드 사이 자리면 버튼이 지나간 뒤 참여합니다.
    </p>
  );
}
