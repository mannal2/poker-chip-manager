import type { GameEvent } from '../../../game/types';
import type { RoomSnapshot } from '../api/types';
import type { KnownEvent } from '../model/eventNotices';

const LIMIT = 200;

// 취소 알림에 쓸 최근 확정 이벤트와 행동자 이름을 보관한다
export class EventMemory {
  private known = new Map<string, KnownEvent>();

  // 보관 중인 이벤트를 읽기 전용으로 돌려준다
  get events(): ReadonlyMap<string, KnownEvent> {
    return this.known;
  }

  // 토너먼트가 바뀌면 이전 기록을 버린다
  clear(): void {
    this.known.clear();
  }

  // 처음 본 이벤트만 기록해 돌려주고 오래된 기록을 정리한다
  record(events: GameEvent[], next: RoomSnapshot, previous: RoomSnapshot | null): GameEvent[] {
    const fresh: GameEvent[] = [];
    for (const event of events) {
      if (this.known.has(event.id)) continue;
      fresh.push(event);
      const id = event.details.playerId;
      const actorName =
        next.game?.players.find((p) => p.id === id)?.name ??
        previous?.game?.players.find((p) => p.id === id)?.name;
      this.known.set(event.id, { event, actorName });
    }
    while (this.known.size > LIMIT) this.known.delete(this.known.keys().next().value!);
    return fresh;
  }
}
