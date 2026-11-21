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
  ['WAITING', true, ['홈', '방 나가기', '방장 넘기기', '플레이어 내보내기']],
  ['WAITING', false, ['홈', '방 나가기']],
  ['PLAYING', true, ['홈', '바이인', '기권', '기권 처리', '방장 넘기기', '토너먼트 중단']],
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
it.each([
  ['eliminated', ['홈', '바이인', '방 나가기']],
  ['forfeited', ['홈', '바이인', '방 나가기']],
] as const)('offers leaving to %s players', (flag, labels) => {
  const snapshot = playing(false);
  guestPlayer(snapshot).player[flag] = true;
  const items = menuItems(snapshot);
  expect(items.map((i) => i.label)).toEqual(labels);
  const leave = items.find((i) => i.label === '방 나가기')!;
  expect(leave.command?.type).toBe('LEAVE');
  expect(leave.confirm).toContain('다시 들어올 수 없습니다');
});

// 탈락한 본인의 메뉴에만 재입장 바이인 신청 버튼이 있다
it('offers a buy-in request to an eliminated guest', () => {
  const snapshot = playing(false);
  const { player } = guestPlayer(snapshot);
  expect(menuItems(snapshot).some((i) => i.label === '바이인')).toBe(false);
  player.eliminated = true;
  const buyIn = menuItems(snapshot).find((i) => i.label === '바이인');
  expect(buyIn?.command).toEqual({ type: 'REQUEST_BUY_IN', handScoped: false });
  expect(buyIn?.confirm).toBeUndefined();
  snapshot.roomPhase = 'RESULT';
  expect(menuItems(snapshot).some((i) => i.label === '바이인')).toBe(false);
});

// 방장의 바이인 버튼은 탈락 여부와 관계없이 대기 중인 바이인 대화상자를 연다
it.each([false, true])('opens the waiting buy-ins for the host (eliminated=%s)', (out) => {
  const snapshot = playing(true);
  snapshot.game.players[0].eliminated = out;
  const items = menuItems(snapshot).filter((i) => i.label === '바이인');
  expect(items).toHaveLength(1);
  expect(items[0].opens).toBe('buy-ins');
  expect(items[0].command).toBeUndefined();
  snapshot.game.status = 'ended';
  expect(menuItems(snapshot).some((i) => i.label === '바이인')).toBe(false);
});

// 기권한 플레이어의 바이인 버튼은 핸드가 끝나기 전에는 흐리게 보이고, 누르면 신청할 수 있는 시점을 알린다
it('explains when a forfeited player can buy in', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const snapshot = playing(false);
  const { player } = guestPlayer(snapshot);
  player.forfeited = true;
  player.eliminated = false;
  const item = menuItems(snapshot).find((i) => i.label === '바이인');
  expect(item?.command).toBeUndefined();
  expect(item?.explains).toBe('이번 핸드가 끝나면 바이인을 신청할 수 있습니다.');
  const host = document.createElement('div');
  const root = createRoot(host);
  const choose = vi.fn();
  const notify = vi.fn();
  act(() =>
    root.render(<OnlineMenu snapshot={snapshot} choose={choose} home={() => {}} notify={notify} />),
  );
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === '바이인')!;
  expect(button.getAttribute('aria-disabled')).toBe('true');
  act(() => button.click());
  expect(notify).toHaveBeenCalledWith('이번 핸드가 끝나면 바이인을 신청할 수 있습니다.');
  expect(choose).not.toHaveBeenCalled();
  act(() => root.unmount());
  vi.unstubAllGlobals();
  player.eliminated = true;
  expect(menuItems(snapshot).find((i) => i.label === '바이인')?.command?.type).toBe('REQUEST_BUY_IN');
});

// 자리를 다른 바이인에게 내준 탈락자도 재입장을 신청할 수 있다
it('offers a buy-in request to a player whose seat was taken', () => {
  const snapshot = playing(false);
  const { player } = guestPlayer(snapshot);
  snapshot.game.players = snapshot.game.players.filter((p) => p.id !== player.id);
  snapshot.game.formerPlayers = [
    { id: player.id, name: player.name, entry: 1, reason: 'replaced' },
  ];
  expect(menuItems(snapshot).some((i) => i.label === '바이인')).toBe(true);
  snapshot.game.formerPlayers[0].reason = 'cancelled';
  expect(menuItems(snapshot).some((i) => i.label === '바이인')).toBe(false);
});

// 재입장 신청이 대기 중이면 버튼 자리에 대기 안내를 보이고 다시 누를 수 없다
it('shows the waiting notice instead of the button while a re-entry is pending', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const snapshot = playing(false);
  const { guest, player } = guestPlayer(snapshot);
  player.eliminated = true;
  snapshot.buyInRequests = [
    {
      buyInRequestId: 'b',
      name: guest.name,
      reentryOf: player.id,
      requestedAt: 'now',
      expiresAt: 'later',
    },
  ];
  const items = menuItems(snapshot);
  expect(items.map((i) => i.label)).toEqual([
    '홈',
    '방장의 승인을 기다리고 있습니다.',
    '방 나가기',
  ]);
  expect(items[1].command).toBeUndefined();
  const host = document.createElement('div');
  const root = createRoot(host);
  const choose = vi.fn();
  act(() =>
    root.render(<OnlineMenu snapshot={snapshot} choose={choose} home={() => {}} notify={() => {}} />),
  );
  const notice = host.querySelector('[role="status"]');
  expect(notice?.textContent).toBe('방장의 승인을 기다리고 있습니다.');
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
    '방장의 승인을 기다리고 있습니다.',
  );
  act(() => root.unmount());
  vi.unstubAllGlobals();
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
