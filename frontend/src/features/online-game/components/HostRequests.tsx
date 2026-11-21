import { useState } from 'react';
import { Dialog } from '../../../shared/ui/Dialog';
import { BuyInApproval } from './BuyInApproval';
import type { RoomSnapshot, ServerCommand } from '../api/types';

// 알림 줄의 문구와 목록 제목을 신청 종류와 건수로 정한다
function requestLabels(recoveries: { name: string }[], buyIns: { name: string }[]) {
  const total = recoveries.length + buyIns.length;
  if (buyIns.length === 0)
    return {
      line: total === 1 ? `${recoveries[0].name} 복구 신청` : `복구 신청 ${total}건`,
      title: '복구 신청',
    };
  if (total === 1) return { line: `${buyIns[0].name} 바이인 신청`, title: '바이인 신청' };
  return { line: `신청 ${total}건`, title: recoveries.length === 0 ? '바이인 신청' : '신청' };
}

// 복구·바이인 신청과 방장 인수 요청을 한 줄로 표시하고 신청 처리는 대화상자에서 받는다
export function HostRequests({
  snapshot,
  busy,
  send,
}: {
  snapshot: RoomSnapshot;
  busy: boolean;
  send: (command: ServerCommand) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const host = snapshot.hostId === snapshot.you.participantId;
  const recoveries = host ? snapshot.recoveryRequests : [];
  const buyIns = host && snapshot.game ? snapshot.buyInRequests : [];
  const total = recoveries.length + buyIns.length;
  const approval = buyIns.find((r) => r.buyInRequestId === approving);
  // 처리할 신청이 없어지면 다음 신청이 대화상자를 저절로 열지 않게 닫는다
  if (open && total === 0) setOpen(false);
  // 승인 화면의 신청이 처리되거나 만료되면 승인 화면을 닫는다
  if (approving && !approval) setApproving(null);
  const takeover = snapshot.hostTakeoverOpen && snapshot.you.canTakeHost;
  const { line, title } = requestLabels(recoveries, buyIns);
  // 복구 처리 명령을 신청 하나에 대해 보낸다
  function decide(type: 'RECOVERY_APPROVE' | 'RECOVERY_REJECT', recoveryRequestId: string) {
    void send({ type, payload: { recoveryRequestId }, handScoped: false });
  }
  return (
    <>
      <section className="host-requests" aria-label="방장 알림">
        {takeover && (
          <button
            aria-disabled={busy}
            onClick={() => void send({ type: 'TAKE_HOST', handScoped: false })}
          >
            방장 맡기
          </button>
        )}
        {total > 0 && (
          <button aria-label={`${line} 보기`} onClick={() => setOpen(true)}>
            {line} 보기
          </button>
        )}
      </section>
      {approval && snapshot.game ? (
        <BuyInApproval
          key={approval.buyInRequestId}
          request={approval}
          game={snapshot.game}
          busy={busy}
          send={send}
          onClose={() => setApproving(null)}
        />
      ) : (
        open &&
        total > 0 && (
          <Dialog title={title} onClose={() => setOpen(false)}>
            {recoveries.map((request) => (
              <div className="host-request" key={request.recoveryRequestId}>
                <p>{request.name}</p>
                <p>기존 플레이어가 맞는지 확인 후 승인하세요.</p>
                <div className="host-request-actions">
                  <button
                    className="primary"
                    aria-disabled={busy}
                    onClick={() => decide('RECOVERY_APPROVE', request.recoveryRequestId)}
                  >
                    복구 승인
                  </button>
                  <button
                    aria-disabled={busy}
                    onClick={() => decide('RECOVERY_REJECT', request.recoveryRequestId)}
                  >
                    복구 거절
                  </button>
                </div>
              </div>
            ))}
            {buyIns.map((request) => (
              <div className="host-request" key={request.buyInRequestId}>
                <p>{request.name}</p>
                <p>{request.reentryOf ? '재입장 바이인 신청입니다.' : '새 플레이어 바이인 신청입니다.'}</p>
                <div className="host-request-actions">
                  <button
                    className="primary"
                    aria-disabled={busy}
                    onClick={() => setApproving(request.buyInRequestId)}
                  >
                    승인
                  </button>
                  <button
                    aria-disabled={busy}
                    onClick={() =>
                      void send({
                        type: 'BUY_IN_REJECT',
                        payload: { buyInRequestId: request.buyInRequestId },
                        handScoped: false,
                      })
                    }
                  >
                    거절
                  </button>
                </div>
              </div>
            ))}
          </Dialog>
        )
      )}
    </>
  );
}
