import { buildPots } from '../../../game/settlement';
import type { RoomSnapshot } from '../api/types';

// 서버 단계와 보는 사람에 맞는 하단 안내를 반환한다
export function dockNoticeFor(snapshot: RoomSnapshot, viewerId: string): string | null {
  const guest = viewerId !== snapshot.hostId;
  if (snapshot.roomPhase === 'RESULT') return guest ? '방장이 다음 게임을 준비하고 있습니다.' : null;
  const hand = snapshot.game?.hand;
  if (hand?.phase === 'settlement' && guest) {
    const draft = snapshot.settlementDraft;
    const pots = buildPots(snapshot.game!);
    const pot = pots[Math.min(draft?.potIndex ?? 0, pots.length - 1)];
    const selected = pot?.eligible.length === 1 ? 1 : (draft?.winners[pot?.id]?.length ?? 0);
    return `방장이 승자를 선택하고 있습니다. ${selected}명 선택`;
  }
  if (hand?.phase === 'betting') {
    const actor = snapshot.participants.find((p) => p.playerId === hand.actorId);
    if (actor && actor.participantId !== viewerId) return `${actor.name} 차례입니다.`;
  }
  return null;
}
