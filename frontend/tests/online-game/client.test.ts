import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/features/online-game/api/client';

// 토큰 재조회 중 호출자가 본문을 변경해도 최초 직렬화 결과로 재시도한다.
it('preserves the original serialized body while a CSRF reload is pending', async () => {
  let release!: (response: Response) => void;
  const token = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(reply({ code: 'CSRF_REJECTED' }, 403))
    .mockReturnValueOnce(token)
    .mockResolvedValueOnce(reply({ accepted: true }));
  vi.stubGlobal('fetch', fetch);
  const body = { requestId: 'original', payload: { amount: 5 } };
  const pending = new ApiClient().post('/command', body);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  body.requestId = 'changed';
  body.payload.amount = 50;
  release(reply({ csrfToken: 'fresh', protocolVersion: 1 }));
  await pending;
  expect(fetch.mock.calls[0][1].body).toBe('{"requestId":"original","payload":{"amount":5}}');
  expect(fetch.mock.calls[2][1].body).toBe('{"requestId":"original","payload":{"amount":5}}');
});

// JSON 서버 응답을 만든다.
function reply(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}
// 각 테스트에서 대체한 브라우저 경계를 복구한다.
afterEach(() => vi.unstubAllGlobals());

// 세션 토큰과 스트림을 준비하고 변경 요청과 종료 요청에 토큰을 보낸다.
it('opens session before stream, refreshes token and deletes with keepalive', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(reply({ csrfToken: 'a', protocolVersion: 1 }))
    .mockResolvedValueOnce(reply({ streamId: 's' }))
    .mockResolvedValueOnce(reply({ csrfToken: 'b', protocolVersion: 1 }))
    .mockResolvedValueOnce(reply(null, 204));
  vi.stubGlobal('fetch', fetch);
  const api = new ApiClient();
  await api.open();
  expect(api.streamId).toBe('s');
  expect(fetch.mock.calls[1]).toEqual([
    '/api/session/streams',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'a' }),
    }),
  ]);
  await api.refresh();
  expect(await api.closeStream()).toEqual({ ok: true, status: 204, body: undefined });
  expect(fetch.mock.calls[3]).toEqual([
    '/api/session/streams/s',
    expect.objectContaining({
      method: 'DELETE',
      keepalive: true,
      headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'b' }),
    }),
  ]);
});

// CSRF 거절만 한 번 재시도하며 같은 요청 본문을 유지한다.
it('retries CSRF once with a reloaded token and stops on a second rejection', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(reply({ code: 'CSRF_REJECTED' }, 403))
    .mockResolvedValueOnce(reply({ csrfToken: 'new', protocolVersion: 1 }))
    .mockResolvedValueOnce(reply({ code: 'CSRF_REJECTED' }, 403));
  vi.stubGlobal('fetch', fetch);
  expect(await new ApiClient().post('/command', { sequence: 3 })).toEqual({
    ok: false,
    status: 403,
    code: 'CSRF_REJECTED',
    body: { code: 'CSRF_REJECTED' },
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[2][1]).toMatchObject({
    body: '{"sequence":3}',
    headers: { 'X-CSRF-TOKEN': 'new' },
  });
});

// 네트워크 오류와 서버 오류 및 다른 권한 거절은 변경 요청을 재전송하지 않는다.
it('does not replay network errors, 5xx or other 403 responses', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(reply({ code: 'ERROR' }, 503))
    .mockResolvedValueOnce(reply({ code: 'ORIGIN_REJECTED' }, 403));
  vi.stubGlobal('fetch', fetch);
  const api = new ApiClient();
  expect(await api.post('/command', {})).toEqual({ ok: false, unknown: true });
  expect(await api.post('/command', {})).toEqual({ ok: false, unknown: true });
  expect(await api.post('/command', {})).toMatchObject({
    ok: false,
    status: 403,
    code: 'ORIGIN_REJECTED',
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});

// 초기화 실패는 호출자에게 실패 결과를 포함한 예외로 전달한다.
it('rejects open when session or stream preparation fails', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ code: 'DENIED' }, 401));
  vi.stubGlobal('fetch', fetch);
  await expect(new ApiClient().open()).rejects.toMatchObject({
    result: { ok: false, status: 401 },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

// 토큰을 다시 받은 변경 요청은 같은 본문으로 한 번만 실행한다.
it('returns success after one CSRF retry without changing request identity', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(reply({ code: 'CSRF_REJECTED' }, 403))
    .mockResolvedValueOnce(reply({ csrfToken: 'fresh', protocolVersion: 1 }))
    .mockResolvedValueOnce(reply({ accepted: true }));
  vi.stubGlobal('fetch', fetch);
  expect(await new ApiClient().post('/command', { requestId: 'r', sequence: 1 })).toEqual({
    ok: true,
    status: 200,
    body: { accepted: true },
  });
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[2][1].body);
  expect(fetch.mock.calls[2][1].headers['X-CSRF-TOKEN']).toBe('fresh');
});

// 토큰 재조회가 실패하면 원래 변경 요청을 다시 보내지 않는다.
it('stops when token reload fails and exposes stream preparation failure', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(reply({ code: 'CSRF_REJECTED' }, 403))
    .mockResolvedValueOnce(reply({ code: 'EXPIRED' }, 401))
    .mockResolvedValueOnce(reply({ csrfToken: 'a', protocolVersion: 1 }))
    .mockResolvedValueOnce(reply({ code: 'TOO_MANY_STREAMS' }, 409));
  vi.stubGlobal('fetch', fetch);
  const api = new ApiClient();
  expect(await api.post('/command', {})).toMatchObject({ ok: false, status: 401, code: 'EXPIRED' });
  await expect(api.open()).rejects.toMatchObject({
    result: { status: 409, code: 'TOO_MANY_STREAMS' },
  });
  expect(api.streamId).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(4);
});
