// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OnlineApp } from '../../src/features/online-game/OnlineApp';
import { OnlineEntry } from '../../src/features/online-game/components/OnlineEntry';
import {
  OnlineController,
  type OnlineView,
} from '../../src/features/online-game/session/onlineController';

let host: HTMLDivElement;
let root: Root;
// 입장 화면에 필요한 브라우저 환경을 준비한다
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/online/?code=abc234');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const body =
        path === '/api/session'
          ? { csrfToken: 'token', protocolVersion: 1 }
          : path === '/api/session/streams'
            ? { streamId: 'stream' }
            : { code: 'INVALID_NAME' };
      return new Response(JSON.stringify(body), { status: path === '/api/rooms' ? 400 : 200 });
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
// 화면과 대체한 브라우저 환경을 정리한다
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
// React가 변경을 감지하도록 입력 값을 바꾸고 input 이벤트를 보낸다
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
// 초대 코드 입력과 세션의 지연 시작을 확인한다
it('prefills the invite code without contacting the server', async () => {
  await act(() => root.render(<OnlineApp />));
  expect(host.querySelector<HTMLInputElement>('[name="code"]')?.value).toBe('ABC234');
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps only ASCII letters and digits in invite and edited codes', async () => {
  history.replaceState(null, '', '/online/?code=a%20b-한ß23!4');
  await act(() => root.render(<OnlineApp />));
  const input = host.querySelector<HTMLInputElement>('[name="code"]')!;
  expect(input.value).toBe('AB234');
  await act(() => type(input, 'c d-한ß56!7'));
  expect(input.value).toBe('CD567');
  await act(() => type(input, ''));
  expect(input.value).toBe('');
});
// 이름으로 버튼을 찾는다
function button(name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button:not([role="tab"])')].find(
    (b) => b.textContent === name,
  );
}
// 이름으로 탭을 찾는다
function tab(name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (b) => b.textContent === name,
  )!;
}
// 선택된 탭의 이름을 읽는다
function selectedTab() {
  return host.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
}
// 입장 화면에 칸 오류를 띄운 상태를 만든다
function entryView(patch: Partial<OnlineView>): OnlineView {
  return {
    phase: 'entry',
    recovery: null,
    buyIn: null,
    snapshot: null,
    connection: 'offline',
    pending: false,
    error: null,
    errorField: null,
    hasControl: false,
    ...patch,
  };
}
// 이름 거절이 입장 화면으로 돌아와도 이름 칸 아래에 유지되는지 확인한다
it('keeps an invalid name rejection visible on the entry form', async () => {
  await act(() => root.render(<OnlineApp />));
  await act(() => button('방 참가')!.click());
  expect(host.querySelector('#entry-name-error')?.textContent).toBe(
    '이름은 한글, 영문, 숫자, 공백으로 1~10자여야 합니다.',
  );
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('validates recovery name and code on the entry form without contacting the server', async () => {
  history.replaceState(null, '', '/online/');
  await act(() => root.render(<OnlineApp />));
  await act(() => tab('방 참가').click());
  const recover = button('기존 플레이어로 복구')!;
  await act(() => recover.click());
  expect(host.querySelector('#entry-name-error')?.textContent).toBe('이름은 한글, 영문, 숫자, 공백으로 1~10자여야 합니다.');
  await act(() => type(host.querySelector<HTMLInputElement>('[name="name"]')!, 'Alice'));
  await act(() => recover.click());
  expect(host.querySelector('#entry-code-error')?.textContent).toBe('방 코드를 정확히 입력해 주세요.');
  await act(() => type(host.querySelector<HTMLInputElement>('[name="code"]')!, 'ABC123'));
  await act(() => recover.click());
  expect(host.querySelector('#entry-code-error')?.textContent).toBe('방 코드를 정확히 입력해 주세요.');
  expect(fetch).not.toHaveBeenCalled();
});
// 코드 없이 열면 방 만들기 탭이, 링크로 열면 방 참가 탭이 선택된다
it('opens the create tab by default and the join tab from an invite link', async () => {
  history.replaceState(null, '', '/online/');
  await act(() => root.render(<OnlineApp />));
  expect(selectedTab()).toBe('방 만들기');
  expect(host.querySelector('[name="code"]')).toBeNull();
  expect(button('방 참가')).toBeUndefined();
  expect(button('방 만들기')).toBeDefined();
  await act(() => root.unmount());
  root = createRoot(host);
  history.replaceState(null, '', '/online/?code=ab12cd');
  await act(() => root.render(<OnlineApp />));
  expect(selectedTab()).toBe('방 참가');
  expect(host.querySelector<HTMLInputElement>('[name="code"]')?.value).toBe('AB12CD');
});
// 이름 칸은 내 이름 라벨과 늘 보이는 도움말을 가진다
it('labels the name as the player name with a visible rule', async () => {
  await act(() => root.render(<OnlineApp />));
  const input = host.querySelector<HTMLInputElement>('[name="name"]')!;
  expect(input.closest('label')?.textContent).toContain('내 이름');
  expect(host.textContent).toContain(
    '다른 플레이어에게 보이는 이름입니다. 한글·영문·숫자·공백 1~10자로 정해 주세요.',
  );
});
// 탭을 바꿔도 입력한 이름과 코드가 남는다
it('keeps the typed name and code when switching tabs', async () => {
  await act(() => root.render(<OnlineApp />));
  await act(() => type(host.querySelector<HTMLInputElement>('[name="name"]')!, 'Alice'));
  await act(() => tab('방 만들기').click());
  expect(host.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('Alice');
  await act(() => tab('방 참가').click());
  expect(host.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('Alice');
  expect(host.querySelector<HTMLInputElement>('[name="code"]')!.value).toBe('ABC234');
});
// 요청 중에는 탭을 바꿀 수 없다
it('disables the tabs while a request is pending', async () => {
  const controller = new OnlineController({} as never, () => ({}) as never);
  await act(() =>
    root.render(<OnlineEntry view={entryView({ pending: true })} controller={controller} />),
  );
  expect(tab('방 만들기').disabled).toBe(true);
  expect(tab('방 참가').disabled).toBe(true);
});
// 칸 오류는 그 칸 아래에만 뜨고 입력과 연결된다
it('shows a field error only under its field', async () => {
  await act(() => root.render(<OnlineApp />));
  await act(() => button('방 참가')!.click());
  const input = host.querySelector<HTMLInputElement>('[name="name"]')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toContain('entry-name-error');
  expect(host.textContent).not.toContain('다른 플레이어에게 보이는 이름입니다.');
});
// 칸을 고치면 그 칸의 오류가 사라진다
it('clears a field error when the field is edited', async () => {
  await act(() => root.render(<OnlineApp />));
  await act(() => button('방 참가')!.click());
  await act(() => type(host.querySelector<HTMLInputElement>('[name="name"]')!, 'A'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[name="name"]')!.getAttribute('aria-invalid')).toBeNull();
});
// 탭을 바꾸면 칸 오류가 사라진다
it('clears field errors when the tab changes', async () => {
  await act(() => root.render(<OnlineApp />));
  await act(() => button('방 참가')!.click());
  await act(() => tab('방 만들기').click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
// 칸과 무관한 오류는 일반 알림으로 남는다
it('keeps unbound errors in the general alert', async () => {
  const controller = new OnlineController({} as never, () => ({}) as never);
  await act(() =>
    root.render(
      <OnlineEntry view={entryView({ error: '방이 가득 찼습니다.' })} controller={controller} />,
    ),
  );
  expect(host.querySelector('#entry-name-error')).toBeNull();
  expect(host.querySelector('#entry-code-error')).toBeNull();
  expect(host.querySelector('[name="name"]')!.getAttribute('aria-invalid')).toBeNull();
});
// 승인 대기 중에 중복 복구 신청이나 새 입장을 제공하지 않는지 확인한다
it('shows only approval guidance while recovery is pending', async () => {
  const view: OnlineView = {
    phase: 'recovering',
    recovery: { recoveryRequestId: 'r', status: 'PENDING' },
    buyIn: null,
    snapshot: null,
    connection: 'offline',
    pending: false,
    error: null,
    errorField: null,
    hasControl: false,
  };
  const controller = new OnlineController({} as never, () => ({}) as never);
  await act(() => root.render(<OnlineEntry view={view} controller={controller} />));
  expect(host.textContent).toContain('방장의 승인을 기다리고 있습니다');
  expect(host.querySelector('button')).toBeNull();
});
// 브라우저가 오프라인을 알렸을 때 변경 조작을 숨기는지 확인한다
it('offers guidance without mutation controls while offline', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await act(() => root.render(<OnlineApp />));
  expect(host.textContent).toContain('인터넷 연결이 필요합니다.');
  expect(host.querySelector('button')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
// 오프라인에서 시작한 화면도 연결이 돌아오면 저장된 방에 먼저 복귀하는지 확인한다
it('resumes the saved room when an initially offline screen reconnects', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  localStorage.setItem('online.lastRoom', JSON.stringify({ roomId: 'missing' }));
  await act(() => root.render(<OnlineApp />));
  expect(fetch).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  await act(() => window.dispatchEvent(new Event('online')));
  expect(
    vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/missing/state')),
  ).toBe(true);
  vi.restoreAllMocks();
});
// 복구 종료 사유를 실제 컨트롤러를 거쳐 입장 화면에 계속 표시하는지 확인한다
it.each([
  ['REJECTED', '방장이 복구 신청을 거절했습니다.'],
  ['EXPIRED', '복구 신청이 만료되었습니다.'],
  ['SUPERSEDED', '더 최근에 보낸 복구 신청이 있어 이 신청은 취소되었습니다.'],
])('keeps %s recovery guidance after returning to entry', async (status, reason) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const body =
        path === '/api/session'
          ? { csrfToken: 'token', protocolVersion: 1 }
          : path === '/api/session/streams'
            ? { streamId: 'stream' }
            : {
                recoveryRequestId: 'r',
                status: path === '/api/recovery-requests' ? 'PENDING' : status,
                expiresAt: 'later',
              };
      return new Response(JSON.stringify(body));
    }),
  );
  await act(() => root.render(<OnlineApp />));
  await act(() => type(host.querySelector<HTMLInputElement>('[name="name"]')!, 'Alice'));
  await act(() => button('기존 플레이어로 복구')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(reason);
  expect(host.querySelector<HTMLInputElement>('[name="code"]')).not.toBeNull();
  expect(button('기존 플레이어로 복구')?.disabled).toBe(false);
});
// 효과 재실행은 복귀 요청을 중복하지 않고 해제 시 스트림을 닫는지 확인한다
it('resumes once under effect replay and closes the stream on unmount', async () => {
  localStorage.setItem('online.lastRoom', JSON.stringify({ roomId: 'missing' }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      const body =
        path === '/api/session'
          ? { csrfToken: 'token', protocolVersion: 1 }
          : path === '/api/session/streams'
            ? { streamId: 'stream' }
            : { code: 'ROOM_NOT_FOUND' };
      return new Response(JSON.stringify(body), { status: path.endsWith('/state') ? 404 : 200 });
    }),
  );
  await act(() =>
    root.render(
      <StrictMode>
        <OnlineApp />
      </StrictMode>,
    ),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('방을 찾을 수 없습니다.');
  expect(localStorage.getItem('online.lastRoom')).toBeNull();
  expect(
    vi.mocked(fetch).mock.calls.filter(([path]) => String(path).endsWith('/state')),
  ).toHaveLength(1);
  await act(() => root.render(null));
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(
    1,
  );
});
