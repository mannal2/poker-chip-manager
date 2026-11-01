import type { RoomSnapshot, ServerCommand } from '../api/types';

// 복구 신청과 방장 인수 요청을 스냅샷에서 지속적으로 표시한다
export function HostRequests({
  snapshot,
  busy,
  send,
}: {
  snapshot: RoomSnapshot;
  busy: boolean;
  send: (command: ServerCommand) => void;
}) {
  return (
    <section className="host-requests" aria-label="방 관리 요청">
      {snapshot.hostTakeoverOpen && snapshot.you.canTakeHost && (
        <button aria-disabled={busy} onClick={() => send({ type: 'TAKE_HOST', handScoped: false })}>
          방장 맡기
        </button>
      )}
      {snapshot.hostId === snapshot.you.participantId &&
        snapshot.recoveryRequests.map((request) => (
          <div className="host-request" key={request.recoveryRequestId}>
            <p>
              {request.name} · 복구 신청{' '}
              <time dateTime={request.requestedAt}>
                {new Date(request.requestedAt).toLocaleString('ko-KR')}
              </time>
            </p>
            <p>
              실제 사람이 맞는지 직접 확인한 뒤 승인하세요. 승인하면 기존 기기의 참가 권한이
              회수됩니다.
            </p>
            <div className="host-request-actions">
              <button
                aria-disabled={busy}
                onClick={() =>
                  send({
                    type: 'RECOVERY_APPROVE',
                    payload: { recoveryRequestId: request.recoveryRequestId },
                    handScoped: false,
                  })
                }
              >
                복구 승인
              </button>
              <button
                aria-disabled={busy}
                onClick={() =>
                  send({
                    type: 'RECOVERY_REJECT',
                    payload: { recoveryRequestId: request.recoveryRequestId },
                    handScoped: false,
                  })
                }
              >
                복구 거절
              </button>
            </div>
          </div>
        ))}
    </section>
  );
}
