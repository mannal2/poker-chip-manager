import { expect, it } from 'vitest';
import { menuItems } from '../../src/features/online-game/components/OnlineMenu';
import { isRoomSnapshot } from '../../src/features/online-game/api/types';
import { fixture } from './fixtures';

// 실제 계약 스냅샷으로 역할과 단계별 관리 메뉴를 확인한다
it.each([
  ['WAITING', true, ['앱 홈', '방 나가기', '방장 넘기기', '참가자 내보내기']],
  ['WAITING', false, ['앱 홈', '방 나가기']],
  ['PLAYING', true, ['앱 홈', '기권', '방장 넘기기', '토너먼트 중단']],
  ['PLAYING', false, ['앱 홈', '기권']],
  ['RESULT', true, ['앱 홈', '방 나가기', '방장 넘기기', '다시 준비하기']],
  ['RESULT', false, ['앱 홈', '방 나가기']],
] as const)('maps %s host=%s', (phase, host, expected) => {
  const snapshot = fixture('snapshot-playing');
  if (!isRoomSnapshot(snapshot)) throw Error('fixture');
  snapshot.roomPhase = phase;
  snapshot.you.participantId = host
    ? snapshot.hostId
    : snapshot.participants.find((p) => p.participantId !== snapshot.hostId)!.participantId;
  expect(
    menuItems(snapshot, new Set(snapshot.participants.map((p) => p.participantId))).map(
      (item) => item.label,
    ),
  ).toEqual(expected);
});

// 끊긴 생존자만 방장의 기권 처리 대상으로 제공한다
it('only offers disconnected active players for host forfeiture', () => {
  const snapshot = fixture('snapshot-playing');
  if (!isRoomSnapshot(snapshot) || !snapshot.game) throw Error('fixture');
  snapshot.you.participantId = snapshot.hostId;
  const target = snapshot.participants.find((p) => p.participantId !== snapshot.hostId)!;
  expect(
    menuItems(snapshot, new Set([snapshot.hostId]))
      .find((i) => i.label === '기권 처리')
      ?.targets?.map((p) => p.participantId),
  ).toEqual([target.participantId]);
  snapshot.game.players.find((p) => p.id === target.playerId)!.forfeited = true;
  expect(menuItems(snapshot, new Set([snapshot.hostId])).some((i) => i.label === '기권 처리')).toBe(
    false,
  );
  expect(
    menuItems(snapshot, new Set([snapshot.hostId])).find((i) => i.label === '방장 넘기기')?.targets,
  ).toEqual([]);
});

// 탈락 또는 기권한 본인에게는 진행 중 기권 메뉴를 제공하지 않는다
it.each(['eliminated', 'forfeited'] as const)('hides self forfeit for %s players', (flag) => {
  const snapshot = fixture('snapshot-playing');
  if (!isRoomSnapshot(snapshot) || !snapshot.game) throw Error('fixture');
  const target = snapshot.participants.find((p) => p.participantId !== snapshot.hostId)!;
  snapshot.you.participantId = target.participantId;
  snapshot.game.players.find((p) => p.id === target.playerId)![flag] = true;
  expect(menuItems(snapshot, new Set()).map((i) => i.label)).toEqual(['앱 홈']);
});
