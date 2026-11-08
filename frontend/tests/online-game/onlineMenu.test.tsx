// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { OnlineMenu, menuItems } from '../../src/features/online-game/components/OnlineMenu';
import { isRoomSnapshot, type RoomSnapshot } from '../../src/features/online-game/api/types';
import contract from '../../../shared/api-contract/snapshot-playing.json';

// 테스트마다 수정할 수 있는 계약 스냅샷 사본을 만든다
function fixture(): unknown {
  return structuredClone(contract.response);
}

// 계약 스냅샷을 읽고 본인 역할을 정한다
function playing(host: boolean): RoomSnapshot & { game: NonNullable<RoomSnapshot['game']> } {
  const snapshot = fixture();
  if (!isRoomSnapshot(snapshot) || !snapshot.game) throw Error('fixture');
  snapshot.you.participantId = host
    ? snapshot.hostId
    : snapshot.participants.find((p) => p.participantId !== snapshot.hostId)!.participantId;
  return snapshot as RoomSnapshot & { game: NonNullable<RoomSnapshot['game']> };
}

// 방장이 아닌 참가자의 게임 플레이어를 돌려준다
function guestPlayer(snapshot: ReturnType<typeof playing>) {
  const guest = snapshot.participants.find((p) => p.participantId !== snapshot.hostId)!;
  return { guest, player: snapshot.game.players.find((p) => p.id === guest.playerId)! };
}

// 실제 계약 스냅샷으로 역할과 단계별 관리 메뉴를 확인한다
it.each([
  ['WAITING', true, ['홈', '방 나가기', '방장 넘기기', '참가자 내보내기']],
  ['WAITING', false, ['홈', '방 나가기']],
  ['PLAYING', true, ['홈', '기권', '기권 처리', '방장 넘기기', '토너먼트 중단']],
  ['PLAYING', false, ['홈', '기권']],
  ['RESULT', true, ['홈', '방 나가기', '방장 넘기기', '다시 준비하기']],
  ['RESULT', false, ['홈', '방 나가기']],
] as const)('maps %s host=%s', (phase, host, expected) => {
  const snapshot = playing(host);
  snapshot.roomPhase = phase;
  expect(menuItems(snapshot).map((item) => item.label)).toEqual(expected);
});

// 방장의 기권 처리는 연결 여부와 관계없이 게임에 남은 다른 참가자를 대상으로 한다
it('offers connected and disconnected active players for host forfeiture', () => {
  const snapshot = playing(true);
  const { guest } = guestPlayer(snapshot);
  const targets = () =>
    menuItems(snapshot)
      .find((i) => i.label === '기권 처리')
      ?.targets?.map((p) => p.participantId);
  expect(guest.connected).toBe(true);
  expect(targets()).toEqual([guest.participantId]);
  guest.connected = false;
  expect(targets()).toEqual([guest.participantId]);
});

// 기권 처리와 본인 기권은 확인 뒤 방에 남을지 한 번 더 묻는다
it('asks whether to stay after both forfeits', () => {
  const host = menuItems(playing(true));
  const guest = menuItems(playing(false));
  expect(host.find((i) => i.label === '기권 처리')?.then).toBe('stay-or-leave');
  expect(guest.find((i) => i.label === '기권')?.then).toBe('stay-or-leave');
});

// 탈락자가 생기면 방장 메뉴에 진행 중 내보내기가 기권 처리와 같은 줄로 붙는다
it.each(['eliminated', 'forfeited'] as const)('offers in-game kick for %s players', (flag) => {
  const snapshot = playing(true);
  const { guest, player } = guestPlayer(snapshot);
  expect(menuItems(snapshot).some((i) => i.label === '내보내기')).toBe(false);
  player[flag] = true;
  const items = menuItems(snapshot);
  const kick = items.find((i) => i.label === '내보내기');
  expect(kick?.command?.type).toBe('KICK');
  expect(kick?.targets?.map((p) => p.participantId)).toEqual([guest.participantId]);
  expect(items.some((i) => i.label === '기권 처리')).toBe(false);
  expect(items.find((i) => i.label === '방장 넘기기')?.targets).toEqual([]);
});

// 탈락 또는 기권한 본인에게는 기권 대신 방 나가기를 제공한다
it.each(['eliminated', 'forfeited'] as const)('offers leaving to %s players', (flag) => {
  const snapshot = playing(false);
  guestPlayer(snapshot).player[flag] = true;
  const items = menuItems(snapshot);
  expect(items.map((i) => i.label)).toEqual(['홈', '방 나가기']);
  expect(items[1].command?.type).toBe('LEAVE');
  expect(items[1].confirm).toContain('다시 들어올 수 없습니다');
});

// 기권 처리와 내보내기가 함께 있으면 한 줄에 나란히 렌더한다
it('renders host participant actions side by side', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const snapshot = fixture();
  if (!isRoomSnapshot(snapshot) || !snapshot.game) throw Error('fixture');
  snapshot.participants.push({
    ...snapshot.participants[1],
    participantId: '00000000-0000-4000-8000-000000000009',
    name: 'Carol',
    playerId: 'p2',
  });
  snapshot.game.players.push({ ...snapshot.game.players[1], id: 'p2', name: 'Carol', eliminated: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() =>
    root.render(<OnlineMenu snapshot={snapshot} choose={() => {}} home={() => {}} notify={() => {}} />),
  );
  expect([...host.querySelectorAll('.menu-row button')].map((b) => b.textContent)).toEqual([
    '기권 처리',
    '내보내기',
  ]);
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
