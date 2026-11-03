// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '../../src/features/online-game/api/types';
import { HostRequests } from '../../src/features/online-game/components/HostRequests';
import playing from '../../../shared/api-contract/snapshot-playing.json';

// 브라우저 모달 대신 대화상자 내용과 닫기만 검사한다
vi.mock('../../src/shared/ui/Dialog', () => ({
  // 대화상자 자식과 닫기 버튼을 그대로 그린다
  Dialog: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <div role="dialog">
      {children}
      <button onClick={onClose}>닫기</button>
    </div>
  ),
}));

const request = (id: string, name: string) => ({
  recoveryRequestId: id,
  participantId: id,
  name,
  requestedAt: '2026-11-01T00:00:00Z',
  expiresAt: '2026-11-01T00:05:00Z',
});

// 방장 시점의 진행 스냅샷을 만든다
function hostSnapshot(requests: ReturnType<typeof request>[]) {
  const s = structuredClone(playing.response) as unknown as RoomSnapshot;
  s.you.participantId = s.hostId;
  s.recoveryRequests = requests;
  return s;
}

// 컴포넌트를 렌더링하고 다시 그리기 함수와 전송 기록을 돌려준다
function render(snapshot: RoomSnapshot) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const send = vi.fn();
  // 주어진 스냅샷으로 요청 영역을 다시 그린다
  const draw = (next: RoomSnapshot) =>
    act(() => root.render(<HostRequests snapshot={next} busy={false} send={send} />));
  draw(snapshot);
  return { host, send, draw };
}

// 이름이 같은 버튼을 찾는다
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text);

// 신청 한 건은 이름을 보여 주고 승인 버튼은 대화상자에서만 보인다
it('shows one line until the host opens the recovery dialog', () => {
  const { host, send } = render(hostSnapshot([request('r1', 'Bob')]));
  expect(host.querySelector('section')?.textContent).toBe('Bob 복구 신청 · 확인');
  expect(button(host, '복구 승인')).toBeUndefined();
  act(() => button(host, 'Bob 복구 신청 · 확인')!.click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('실제 사람이 맞는지');
  act(() => button(host, '복구 승인')!.click());
  expect(send).toHaveBeenCalledWith({
    type: 'RECOVERY_APPROVE',
    payload: { recoveryRequestId: 'r1' },
    handScoped: false,
  });
});

// 신청이 여러 건이면 건수로 묶고 각 신청을 따로 처리한다
it('groups several requests and decides them separately', () => {
  const { host, send } = render(hostSnapshot([request('r1', 'Bob'), request('r2', 'Carol')]));
  expect(host.querySelector('section')?.textContent).toBe('복구 신청 2건 · 확인');
  act(() => button(host, '복구 신청 2건 · 확인')!.click());
  act(() => host.querySelectorAll<HTMLButtonElement>('.host-request-actions button')[3].click());
  expect(send).toHaveBeenCalledWith({
    type: 'RECOVERY_REJECT',
    payload: { recoveryRequestId: 'r2' },
    handScoped: false,
  });
});

// 처리할 신청이 사라지면 열린 대화상자도 닫힌다
it('closes the dialog when no request remains', () => {
  const snapshot = hostSnapshot([request('r1', 'Bob')]);
  const { host, draw } = render(snapshot);
  act(() => button(host, 'Bob 복구 신청 · 확인')!.click());
  draw(hostSnapshot([]));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  draw(hostSnapshot([request('r2', 'Carol')]));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

// 방장이 아니면 복구 신청을 보여 주지 않고 인수 자격자에게는 방장 맡기를 보여 준다
it('hides recovery from guests and offers the takeover to eligible people', () => {
  const s = hostSnapshot([request('r1', 'Bob')]);
  s.you.participantId = 'guest';
  s.hostTakeoverOpen = true;
  s.you.canTakeHost = true;
  const { host, send } = render(s);
  expect(host.querySelector('section')?.textContent).toBe('방장 맡기');
  act(() => button(host, '방장 맡기')!.click());
  expect(send).toHaveBeenCalledWith({ type: 'TAKE_HOST', handScoped: false });
});
