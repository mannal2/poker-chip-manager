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
  Dialog: ({
    title,
    children,
    actions,
    onClose,
  }: {
    title: string;
    children: ReactNode;
    actions?: ReactNode;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
      {actions}
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
  const send = vi.fn(async () => true);
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
  expect(host.querySelector('section')?.textContent).toBe('Bob 복구 신청 보기');
  expect(button(host, '복구 승인')).toBeUndefined();
  act(() => button(host, 'Bob 복구 신청 보기')!.click());
  expect([...host.querySelectorAll('.host-request p')].map((p) => p.textContent)).toEqual([
    'Bob',
    '기존 플레이어가 맞는지 확인 후 승인하세요.',
  ]);
  expect(host.querySelector('time')).toBeNull();
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
  expect(host.querySelector('section')?.textContent).toBe('복구 신청 2건 보기');
  act(() => button(host, '복구 신청 2건 보기')!.click());
  expect(
    [...host.querySelectorAll('.host-request')].map((item) => item.querySelector('p')?.textContent),
  ).toEqual(['Bob', 'Carol']);
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
  act(() => button(host, 'Bob 복구 신청 보기')!.click());
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

const buyIn = (id: string, name: string, reentryOf: string | null = null) => ({
  buyInRequestId: id,
  name,
  reentryOf,
  requestedAt: '2026-11-01T00:00:00Z',
  expiresAt: '2026-11-01T00:05:00Z',
});

// 방장 시점에서 바이인 신청이 있는 진행 스냅샷을 만든다
function buyInSnapshot(requests: ReturnType<typeof buyIn>[], recoveries: ReturnType<typeof request>[] = []) {
  const s = hostSnapshot(recoveries);
  s.buyInRequests = requests;
  return s;
}

// 신청 목록에서 신청 하나의 승인 화면을 연다
function openApproval(host: HTMLElement, line: string) {
  act(() => button(host, `${line} 보기`)!.click());
  act(() => button(host, '승인')!.click());
}

// 바이인 신청 한 건은 이름과 함께 알림 줄에 뜨고, 복구 신청과 섞이면 건수로 묶는다
it('shows buy-in requests on the same notice line', () => {
  const { host, draw } = render(buyInSnapshot([buyIn('b1', 'Dave')]));
  expect(host.querySelector('section')?.textContent).toBe('Dave 바이인 신청 보기');
  draw(buyInSnapshot([buyIn('b1', 'Dave')], [request('r1', 'Bob')]));
  expect(host.querySelector('section')?.textContent).toBe('신청 2건 보기');
  draw(buyInSnapshot([buyIn('b1', 'Dave'), buyIn('b2', 'Erin')]));
  expect(host.querySelector('section')?.textContent).toBe('신청 2건 보기');
  act(() => button(host, '신청 2건 보기')!.click());
  expect(
    [...host.querySelectorAll('.host-request')].map((item) => item.querySelector('p')?.textContent),
  ).toEqual(['Dave', 'Erin']);
});

// 새 사람의 승인 화면은 이름과 종류를 읽기 전용으로 보이고 고른 자리로 승인한다
it('approves a newcomer into the chosen seat', async () => {
  const { host, send } = render(buyInSnapshot([buyIn('b1', 'Dave')]));
  openApproval(host, 'Dave 바이인 신청');
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('바이인');
  expect(host.querySelector('.applicant')?.textContent).toBe('Dave · 새 플레이어');
  expect(host.querySelector('input')).toBeNull();
  expect(host.querySelector('.guide')?.textContent).toContain('시작 칩 1,000');
  const select = host.querySelector('select')!;
  expect([...select.options].map((o) => o.textContent)).toEqual(['Alice·Bob 사이', 'Bob·Alice 사이']);
  act(() => {
    select.value = 'between:p1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button(host, '바이인 승인')!.click());
  expect(send).toHaveBeenCalledWith({
    type: 'BUY_IN_APPROVE',
    payload: { buyInRequestId: 'b1', placement: { kind: 'between', after: 'p1' } },
    handScoped: false,
  });
  expect(host.querySelector('.applicant')).toBeNull();
});

// 원래 카드가 아직 자리에 있으면 재입장은 자리를 묻지 않고 원래 자리로 승인한다
it('approves a re-entry back into the original seat without asking', async () => {
  const s = buyInSnapshot([buyIn('b1', 'Bob', 'p1')]);
  s.game!.players[1].eliminated = true;
  s.game!.players[1].entry = 2;
  const { host, send } = render(s);
  openApproval(host, 'Bob 바이인 신청');
  expect(host.querySelector('.applicant')?.textContent).toBe('Bob · 재입장 ×3');
  expect(host.querySelector('.hint')?.textContent).toBe('원래 자리로 돌아갑니다.');
  expect(host.querySelector('select')).toBeNull();
  await act(async () => button(host, '바이인 승인')!.click());
  expect(send).toHaveBeenCalledWith({
    type: 'BUY_IN_APPROVE',
    payload: { buyInRequestId: 'b1', placement: { kind: 'replace', playerId: 'p1' } },
    handScoped: false,
  });
});

// 원래 자리를 다른 플레이어가 차지했으면 안내와 함께 자리를 고르게 한다
it('asks for a seat when someone else took the original seat', async () => {
  const s = buyInSnapshot([buyIn('b1', 'Bob', 'p1')]);
  s.game!.players[1] = { ...s.game!.players[1], id: 'p2', name: 'Dave' };
  s.game!.formerPlayers = [{ id: 'p1', name: 'Bob', entry: 1, reason: 'replaced' }];
  const { host, send } = render(s);
  openApproval(host, 'Bob 바이인 신청');
  expect(host.querySelector('.applicant')?.textContent).toBe('Bob · 재입장 ×2');
  expect(host.querySelector('.hint')?.textContent).toBe(
    '원래 자리에 다른 플레이어가 앉아 있습니다. 앉을 자리를 골라 주세요.',
  );
  expect(host.querySelector('select')).not.toBeNull();
  await act(async () => button(host, '바이인 승인')!.click());
  expect(send).toHaveBeenCalledWith({
    type: 'BUY_IN_APPROVE',
    payload: { buyInRequestId: 'b1', placement: { kind: 'between', after: 'p0' } },
    handScoped: false,
  });
});

// 목록과 승인 화면의 거절은 자리를 묻지 않고 바로 거절한다
it('rejects a buy-in from the list and from the approval screen', async () => {
  const { host, send } = render(buyInSnapshot([buyIn('b1', 'Dave')]));
  act(() => button(host, 'Dave 바이인 신청 보기')!.click());
  act(() => button(host, '거절')!.click());
  expect(send).toHaveBeenLastCalledWith({
    type: 'BUY_IN_REJECT',
    payload: { buyInRequestId: 'b1' },
    handScoped: false,
  });
  act(() => button(host, '승인')!.click());
  await act(async () => button(host, '거절')!.click());
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith({
    type: 'BUY_IN_REJECT',
    payload: { buyInRequestId: 'b1' },
    handScoped: false,
  });
});

// 승인 화면에 있던 신청이 사라지면 화면을 닫는다
it('closes the approval screen when the request goes away', () => {
  const { host, draw } = render(buyInSnapshot([buyIn('b1', 'Dave')]));
  openApproval(host, 'Dave 바이인 신청');
  draw(buyInSnapshot([]));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
