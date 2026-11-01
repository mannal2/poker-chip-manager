import { expect, it } from 'vitest';
import type { GameEvent } from '../../src/game/types';
import { noticesFor, type KnownEvent } from '../../src/features/online-game/model/eventNotices';

// 알림 검사에 필요한 최소 이벤트를 만든다.
function event(id: string, type: string, details: GameEvent['details'] = {}): GameEvent {
  return { id, type, details, at: '', tournamentId: 't', hand: 1 };
}
// 자동 후속 행동보다 원래 취소 대상의 이름과 금액을 우선한다.
it('describes the original undone action before automatic follow-ups', () => {
  const known = new Map<string, KnownEvent>([
    [
      'call',
      { event: event('call', 'CALL', { playerId: 'p', additional: 50 }), actorName: '민수' },
    ],
    ['auto', { event: event('auto', 'FOLD', { auto: true }), actorName: '영희' }],
  ]);
  expect(noticesFor([event('undo', 'UNDO', { eventIds: ['auto', 'call'] })], known)).toEqual([
    '방장이 민수의 콜 50을 취소했습니다',
  ]);
});
// 찾을 수 없는 취소 대상에는 지정된 일반 문구를 사용한다.
it('falls back when the original undone event is unknown', () => {
  expect(noticesFor([event('undo', 'UNDO', { eventIds: ['missing'] })], new Map())).toEqual([
    '방장이 직전 행동을 취소했습니다',
  ]);
});
// 자동 체크와 폴드만 알리고 일반 행동은 알리지 않는다.
it('announces automatic checks and folds but not ordinary actions', () => {
  const events = [
    event('check', 'CHECK', { auto: true }),
    event('fold', 'FOLD', { auto: true }),
    event('call', 'CALL'),
  ];
  const known = new Map(events.map((e) => [e.id, { event: e, actorName: '민수' }]));
  expect(noticesFor(events, known)).toEqual(['민수 - 체크(자동)', '민수 - 폴드(자동)']);
});
