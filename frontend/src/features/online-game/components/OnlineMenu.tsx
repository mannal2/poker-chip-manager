import { useState } from 'react';
import type { RoomParticipant, RoomSnapshot, ServerCommand } from '../api/types';

// 관리 메뉴 항목 하나
export interface MenuItem {
  label: string;
  command?: ServerCommand;
  targets?: RoomParticipant[];
  confirm?: string;
}

export const forfeitWarning =
  '현재 핸드에서 폴드하고 탈락합니다. 남은 칩은 핸드가 끝난 뒤 다른 참가자에게 나눠집니다. 되돌릴 수 없습니다.';
export const resetWarning =
  '이전 결과와 기록이 삭제됩니다. 이름과 좌석은 유지하고 다시 준비하시겠습니까?';

// 역할과 단계 및 서버 명단의 생존 여부로 관리 메뉴와 대상을 구성한다
export function menuItems(snapshot: RoomSnapshot, connectedIds: ReadonlySet<string>): MenuItem[] {
  const host = snapshot.you.participantId === snapshot.hostId;
  // 서버 게임의 기권과 탈락 상태를 모두 확인한다
  const active = (participant: RoomParticipant) =>
    snapshot.game?.players.some(
      (p) => p.id === participant.playerId && !p.eliminated && !p.forfeited,
    ) ?? false;
  const others = snapshot.participants.filter(
    (p) => p.participantId !== snapshot.you.participantId,
  );
  const items: MenuItem[] = [{ label: '앱 홈' }];
  if (snapshot.roomPhase !== 'PLAYING')
    items.push({ label: '방 나가기', command: { type: 'LEAVE', handScoped: false } });
  if (snapshot.roomPhase === 'PLAYING') {
    const targets = others.filter((p) => active(p) && !connectedIds.has(p.participantId));
    if (host && targets.length)
      items.push({
        label: '기권 처리',
        command: { type: 'FORFEIT_DISCONNECTED', handScoped: false },
        targets,
        confirm: forfeitWarning,
      });
    if (
      snapshot.participants.some((p) => p.participantId === snapshot.you.participantId && active(p))
    )
      items.push({
        label: '기권',
        command: { type: 'FORFEIT', handScoped: false },
        confirm: forfeitWarning,
      });
  }
  if (host) {
    items.push({
      label: '방장 넘기기',
      command: { type: 'TRANSFER_HOST', handScoped: false },
      targets: others.filter((p) => snapshot.roomPhase !== 'PLAYING' || active(p)),
    });
    if (snapshot.roomPhase === 'WAITING')
      items.push({
        label: '참가자 내보내기',
        command: { type: 'KICK', handScoped: false },
        targets: others,
      });
    if (snapshot.roomPhase === 'PLAYING')
      items.push({
        label: '토너먼트 중단',
        command: { type: 'ABORT', handScoped: false },
        confirm:
          '중단하면 재개·베팅·정산을 할 수 없습니다. 미정산 팟은 보존됩니다. 토너먼트를 중단하시겠습니까?',
      });
    if (snapshot.roomPhase === 'RESULT')
      items.push({
        label: '다시 준비하기',
        command: { type: 'RE_READY', handScoped: false },
        confirm: resetWarning,
      });
  }
  return items;
}

// 공통 관리 대화상자 안에서 메뉴와 대상 선택만 표시한다
export function OnlineMenu({
  snapshot,
  choose,
  home,
}: {
  snapshot: RoomSnapshot;
  choose: (item: MenuItem, target?: RoomParticipant) => void;
  home: () => void;
}) {
  const [expanded, setExpanded] = useState('');
  const items = menuItems(
    snapshot,
    new Set(snapshot.participants.filter((p) => p.connected).map((p) => p.participantId)),
  );
  return (
    <div className="menu-actions">
      {items.map((item) => (
        <div key={item.label}>
          <button
            onClick={() =>
              item.label === '앱 홈'
                ? home()
                : item.targets
                  ? setExpanded(item.label)
                  : choose(item)
            }
          >
            {item.label}
          </button>
          {expanded === item.label && item.targets && (
            <div role="group" aria-label={`${item.label} 대상`}>
              {item.targets.length === 0 && <p>대상 참가자가 없습니다.</p>}
              {item.targets.map((target) => (
                <button key={target.participantId} onClick={() => choose(item, target)}>
                  {target.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
