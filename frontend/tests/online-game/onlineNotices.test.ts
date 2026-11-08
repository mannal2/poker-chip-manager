import { expect, it } from 'vitest';
import type { RoomSnapshot } from '../../src/features/online-game/api/types';
import { dockNoticeFor } from '../../src/features/online-game/model/onlineNotices';
import { fixture } from './fixtures';

// 서버의 현재 행동자와 보는 사람을 비교해 차례 안내를 확인한다
it('announces another actor and stays quiet for the actor', () => {
  const s = fixture('snapshot-playing') as RoomSnapshot;
  const actor = s.participants.find((p) => p.playerId === s.game!.hand!.actorId)!;
  s.game!.hand!.pending.reverse();
  const other = s.participants.find((p) => p !== actor)!;
  expect(dockNoticeFor(s, other.participantId)).toBe(`${actor.name} 차례입니다.`);
  expect(dockNoticeFor(s, actor.participantId)).toBeNull();
});

// 정산과 결과 단계에서는 비방장에게 방장의 진행 상황을 표시한다
it('announces host settlement and result preparation only to guests', () => {
  const s = fixture('snapshot-playing') as RoomSnapshot;
  const guest = s.participants.find((p) => p.participantId !== s.hostId)!;
  s.game!.hand!.phase = 'settlement';
  s.settlementDraft = {
    draftVersion: 1,
    potIndex: 0,
    winners: { pot1: ['p1'], pot0: ['p0', 'p1'] },
  };
  expect(dockNoticeFor(s, guest.participantId)).toBe('방장이 승자를 선택하고 있습니다. 2명 선택');
  expect(dockNoticeFor(s, s.hostId)).toBeNull();
  s.roomPhase = 'RESULT';
  expect(dockNoticeFor(s, guest.participantId)).toBe('방장이 다음 게임을 준비하고 있습니다.');
  expect(dockNoticeFor(s, s.hostId)).toBeNull();
});

// 단독 자격 팟은 초안이 없어도 자동 선택된 한 명을 표시한다
it('counts the automatically selected winner of a sole-eligible pot', () => {
  const s = fixture('snapshot-settlement') as RoomSnapshot;
  const guest = s.participants.find((p) => p.participantId !== s.hostId)!;
  s.game!.players[1].folded = true;
  s.settlementDraft = null;
  expect(dockNoticeFor(s, guest.participantId)).toBe('방장이 승자를 선택하고 있습니다. 1명 선택');
});
