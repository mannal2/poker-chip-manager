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
// 초대 코드 입력과 세션의 지연 시작을 확인한다
it('prefills the invite code without contacting the server', async () => {
  await act(() => root.render(<OnlineApp />));
  expect(host.querySelector<HTMLInputElement>('[name="code"]')?.value).toBe('abc234');
  expect(fetch).not.toHaveBeenCalled();
});
// 이름 거절이 입장 화면으로 돌아와도 유지되는지 확인한다
it('keeps an invalid name rejection visible on the entry form', async () => {
  await act(() => root.render(<OnlineApp />));
  await act(() => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(host.textContent).toContain('이름은 한글, 영문, 숫자, 공백으로 1~10자여야 합니다.');
  expect(host.querySelector('input')).not.toBeNull();
});
// 승인 대기 중에 중복 복구 신청이나 새 입장을 제공하지 않는지 확인한다
it('shows only approval guidance while recovery is pending', async () => {
  const view: OnlineView = {
    phase: 'recovering',
    recovery: { recoveryRequestId: 'r', status: 'PENDING' },
    snapshot: null,
    connection: 'offline',
    pending: false,
    error: null,
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
  ['SUPERSEDED', '다른 복구 신청으로 대체되었습니다.'],
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
  await act(() => host.querySelectorAll<HTMLButtonElement>('button')[2].click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(reason);
  expect(host.querySelector<HTMLInputElement>('[name="code"]')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
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
