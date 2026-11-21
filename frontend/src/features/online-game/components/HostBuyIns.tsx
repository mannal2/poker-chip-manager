import { Dialog } from '../../../shared/ui/Dialog';
import { WaitingBuyIns } from '../../gameplay/components/BuyInParts';
import { canRequestReentry, reentryPending } from './OnlineMenu';
import type { RoomSnapshot, ServerCommand } from '../api/types';
import '../../gameplay/styles/buyIn.css';

// 방장 메뉴의 바이인 대화상자. 대기 중인 바이인을 취소하고 탈락한 방장은 재입장을 신청한다
export function HostBuyIns({
  snapshot,
  busy,
  send,
  onClose,
}: {
  snapshot: RoomSnapshot;
  busy: boolean;
  send: (command: ServerCommand) => Promise<boolean>;
  onClose: () => void;
}) {
  const waiting = snapshot.game?.players.filter((p) => p.joining) ?? [];
  const me = snapshot.participants.find((p) => p.participantId === snapshot.you.participantId);
  const canAsk = !!me && canRequestReentry(snapshot, me) && !reentryPending(snapshot, me);
  // 방장 본인의 재입장을 신청하고, 신청은 알림 줄의 바이인 신청으로 승인한다
  async function ask() {
    if (busy) return;
    if (await send({ type: 'REQUEST_BUY_IN', handScoped: false })) onClose();
  }
  return (
    <Dialog title="바이인" scrollable onClose={onClose}>
      <div className="buy-in">
        {waiting.length > 0 ? (
          <WaitingBuyIns
            waiting={waiting}
            busy={busy}
            onCancel={(playerId) =>
              void send({ type: 'CANCEL_BUY_IN', payload: { playerId }, handScoped: false })
            }
          />
        ) : (
          <p className="hint">대기 중인 바이인이 없습니다.</p>
        )}
        {canAsk && (
          <button aria-disabled={busy} onClick={() => void ask()}>
            재입장 신청
          </button>
        )}
      </div>
    </Dialog>
  );
}
