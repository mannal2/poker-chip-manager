// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '../../src/features/online-game/api/types';
import { HostBuyIns } from '../../src/features/online-game/components/HostBuyIns';
import playing from '../../../shared/api-contract/snapshot-playing.json';

// 브라우저 모달 대신 대화상자 제목과 내용만 그린다
vi.mock('../../src/shared/ui/Dialog', () => ({
  // 대화상자 자식과 닫기 버튼을 그대로 그린다
  Dialog: ({ title, children }: { title: string; children: ReactNode }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

// 방장 시점의 진행 스냅샷을 만든다
function hostSnapshot() {
  const s = structuredClone(playing.response) as unknown as RoomSnapshot;
  s.you.participantId = s.hostId;
  return s;
}

// 대화상자를 그리고 전송 기록을 돌려준다
function render(snapshot: RoomSnapshot) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  const root = createRoot(host);
  const send = vi.fn(async () => true);
  const onClose = vi.fn();
  act(() =>
    root.render(<HostBuyIns snapshot={snapshot} busy={false} send={send} onClose={onClose} />),
  );
  return { host, send, onClose };
}

// 이름이 같은 버튼을 찾는다
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text);

// 대기 중인 바이인마다 바이인 취소 버튼이 있고 누르면 그 플레이어를 취소한다
it('cancels a waiting buy-in', () => {
  const s = hostSnapshot();
  s.game!.players.push({ ...s.game!.players[1], id: 'p2', name: 'Dave', joining: 'next-hand' });
  const { host, send } = render(s);
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('바이인');
  expect(host.querySelector('h3')?.textContent).toBe('대기 중인 바이인');
  expect([...host.querySelectorAll('.waiting li span')].map((e) => e.textContent)).toEqual(['Dave']);
  act(() => button(host, '바이인 취소')!.click());
  expect(send).toHaveBeenCalledWith({
    type: 'CANCEL_BUY_IN',
    payload: { playerId: 'p2' },
    handScoped: false,
  });
});

// 대기 중인 바이인이 없으면 그렇게 알린다
it('says when nothing is waiting', () => {
  const { host } = render(hostSnapshot());
  expect(host.querySelector('.waiting')).toBeNull();
  expect(host.textContent).toContain('대기 중인 바이인이 없습니다.');
  expect(button(host, '재입장 신청')).toBeUndefined();
});

// 탈락한 방장은 이 대화상자에서 자기 재입장을 신청하고, 신청 중이면 다시 신청할 수 없다
it('lets an eliminated host ask to re-enter once', async () => {
  const s = hostSnapshot();
  s.game!.players[0].eliminated = true;
  const { host, send, onClose } = render(s);
  await act(async () => button(host, '재입장 신청')!.click());
  expect(send).toHaveBeenCalledWith({ type: 'REQUEST_BUY_IN', handScoped: false });
  expect(onClose).toHaveBeenCalled();
  s.buyInRequests = [
    { buyInRequestId: 'b', name: 'Alice', reentryOf: 'p0', requestedAt: 'now', expiresAt: 'later' },
  ];
  expect(button(render(s).host, '재입장 신청')).toBeUndefined();
});
