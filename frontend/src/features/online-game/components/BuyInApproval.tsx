import { useState } from 'react';
import { Dialog } from '../../../shared/ui/Dialog';
import { seatOptions } from '../../gameplay/model/buyIn';
import { SeatField } from '../../gameplay/components/SeatField';
import { BuyInGuide, ReentrySeat } from '../../gameplay/components/BuyInParts';
import type { GameState } from '../../../game/types';
import type { RoomSnapshot, ServerCommand } from '../api/types';
import '../../gameplay/styles/buyIn.css';

// 스냅샷에 실린 대기 중인 바이인 신청 하나
export type BuyInRequest = RoomSnapshot['buyInRequests'][number];

// 재입장 신청의 원래 카드가 아직 자리에 있는지와 다음 입장 번호를 찾는다
function reentryOrigin(game: GameState, playerId: string) {
  const player = game.players.find((p) => p.id === playerId);
  if (player) return { seated: true, next: (player.entry ?? 1) + 1 };
  const former = game.formerPlayers?.find((f) => f.id === playerId);
  return { seated: false, next: (former?.entry ?? 1) + 1 };
}

// 방장이 바이인 신청 하나를 자리와 함께 승인하거나 거절하는 화면
export function BuyInApproval({
  request,
  game,
  busy,
  send,
  onClose,
}: {
  request: BuyInRequest;
  game: GameState;
  busy: boolean;
  send: (command: ServerCommand) => Promise<boolean>;
  onClose: () => void;
}) {
  const [seatKey, setSeatKey] = useState('');
  const options = seatOptions(game);
  const seat = options.find((o) => o.key === seatKey) ?? options[0];
  const origin = request.reentryOf ? reentryOrigin(game, request.reentryOf) : null;
  // 원래 카드가 자리에 있는 재입장은 서버 규칙대로 원래 자리로만 승인한다
  const placement =
    origin?.seated && request.reentryOf
      ? { kind: 'replace' as const, playerId: request.reentryOf }
      : seat?.placement;
  const kind = origin ? `재입장 ×${origin.next}` : '새 플레이어';

  // 신청 하나에 대한 처리 명령을 보내고 성공하면 화면을 닫는다
  async function decide(type: 'BUY_IN_APPROVE' | 'BUY_IN_REJECT') {
    if (busy || (type === 'BUY_IN_APPROVE' && !placement)) return;
    const payload =
      type === 'BUY_IN_APPROVE'
        ? { buyInRequestId: request.buyInRequestId, placement }
        : { buyInRequestId: request.buyInRequestId };
    if (await send({ type, payload, handScoped: false })) onClose();
  }

  return (
    <Dialog
      title="바이인"
      scrollable
      onClose={onClose}
      actions={
        <>
          <button
            className="primary"
            aria-disabled={busy || !placement}
            onClick={() => void decide('BUY_IN_APPROVE')}
          >
            바이인 승인
          </button>
          <button aria-disabled={busy} onClick={() => void decide('BUY_IN_REJECT')}>
            거절
          </button>
        </>
      }
    >
      <div className="buy-in">
        <p className="applicant">
          {request.name} · {kind}
        </p>
        {origin ? (
          <ReentrySeat
            seated={origin.seated}
            options={options}
            seat={seat}
            busy={busy}
            onChange={setSeatKey}
          />
        ) : (
          <SeatField options={options} seat={seat} busy={busy} onChange={setSeatKey} />
        )}
        <BuyInGuide initial={game.settings.initial} />
      </div>
    </Dialog>
  );
}
