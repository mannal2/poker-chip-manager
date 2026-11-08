import type { GameEvent } from '../../../game/types';

// 알림 문구에 쓰는 이벤트와 행동자 이름
export interface KnownEvent {
  event: GameEvent;
  actorName?: string;
}
const actions: Record<string, string> = {
  CHECK: '체크',
  CALL: '콜',
  BET: '베팅',
  RAISE: '레이즈',
  ALL_IN: '올인',
  FOLD: '폴드',
};

// 확정 이벤트와 이름을 보관한 최근 기록에서 화면 알림을 만든다
export function noticesFor(events: GameEvent[], known: ReadonlyMap<string, KnownEvent>): string[] {
  const notices: string[] = [];
  for (const event of events) {
    if (event.type === 'UNDO') {
      const ids = event.details.eventIds as string[] | undefined;
      const original = ids
        ?.map((id) => known.get(id))
        .find((item) => item && actions[item.event.type] && !item.event.details.auto);
      if (!original?.actorName) notices.push('방장이 직전 행동을 취소했습니다.');
      else {
        const { type, details } = original.event;
        const amount = ['CHECK', 'FOLD'].includes(type) ? '' : ` ${details.additional}`;
        const particle = !amount && ['CHECK', 'FOLD'].includes(type) ? '를' : '을';
        notices.push(
          `방장이 ${original.actorName}의 ${actions[type]}${amount}${particle} 취소했습니다.`,
        );
      }
    } else if (event.details.auto && ['CHECK', 'FOLD'].includes(event.type)) {
      const name = known.get(event.id)?.actorName ?? '플레이어';
      notices.push(`${name} - ${actions[event.type]}(자동)`);
    }
  }
  return notices;
}
