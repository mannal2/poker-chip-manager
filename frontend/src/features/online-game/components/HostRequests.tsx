import { useState } from 'react';
import { Dialog } from '../../../shared/ui/Dialog';
import type { RoomSnapshot, ServerCommand } from '../api/types';

// 복구 신청과 방장 인수 요청을 한 줄로 표시하고 복구 처리는 대화상자에서 받는다
export function HostRequests({
  snapshot,
  busy,
  send,
}: {
  snapshot: RoomSnapshot;
  busy: boolean;
  send: (command: ServerCommand) => void;
}) {
  const [open, setOpen] = useState(false);
  const requests = snapshot.hostId === snapshot.you.participantId ? snapshot.recoveryRequests : [];
  // 처리할 신청이 없어지면 다음 신청이 대화상자를 저절로 열지 않게 닫는다
  if (open && requests.length === 0) setOpen(false);
  const takeover = snapshot.hostTakeoverOpen && snapshot.you.canTakeHost;
  const label =
    requests.length === 1 ? `${requests[0].name} 복구 신청` : `복구 신청 ${requests.length}건`;
  // 복구 처리 명령을 신청 하나에 대해 보낸다
  function decide(type: 'RECOVERY_APPROVE' | 'RECOVERY_REJECT', recoveryRequestId: string) {
    send({ type, payload: { recoveryRequestId }, handScoped: false });
  }
  return (
    <>
      <section
        className={`host-requests ${snapshot.roomPhase === 'WAITING' ? 'below-waiting-bar' : ''}`}
        aria-label="방 관리 요청"
      >
        {takeover && (
          <button
            aria-disabled={busy}
            onClick={() => send({ type: 'TAKE_HOST', handScoped: false })}
          >
            방장 맡기
          </button>
        )}
        {requests.length > 0 && (
          <button aria-label={`${label} 확인`} onClick={() => setOpen(true)}>
            {label} · 확인
          </button>
        )}
      </section>
      {open && requests.length > 0 && (
        <Dialog title="복구 신청" onClose={() => setOpen(false)}>
          <p>
            실제 사람이 맞는지 직접 확인한 뒤 승인하세요. 승인하면 기존 기기의 참가 권한이
            회수됩니다.
          </p>
          {requests.map((request) => (
            <div className="host-request" key={request.recoveryRequestId}>
              <p>
                {request.name}{' '}
                <time dateTime={request.requestedAt}>
                  {new Date(request.requestedAt).toLocaleString('ko-KR')}
                </time>
              </p>
              <div className="host-request-actions">
                <button
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
        </Dialog>
      )}
    </>
  );
}
