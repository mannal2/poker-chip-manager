import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../../shared/api-contract/create-room.json';
import playing from '../../../shared/api-contract/snapshot-playing.json';
import { OnlineController } from '../../src/features/online-game/session/onlineController';
import type { RoomSocketHandlers } from '../../src/features/online-game/realtime/roomSocket';
import type { JoinResponse, RoomSnapshot } from '../../src/features/online-game/api/types';

const controllers: OnlineController[] = [];
// 같은 발행 묶음과 후속 발행에 중복된 이벤트 ID의 효과를 한 번만 전달한다.
it('deduplicates confirmed event ids within and across publications', async () => {
  const x = setup();
  await x.enter();
  const before = x.c.getView().snapshot!;
  const event = {
    id: 'same',
    type: 'CHECK',
    tournamentId: before.tournamentId!,
    hand: 1,
    at: '',
    details: {},
  };
  const confirmed = vi.fn();
  x.c.onConfirmed(confirmed);
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: before.stateVersion,
    state: { ...before, stateVersion: before.stateVersion + 1 },
    events: [event, event],
  });
  expect(confirmed.mock.calls[0][0].events).toEqual([event]);
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: before.stateVersion + 1,
    state: { ...before, stateVersion: before.stateVersion + 2 },
    events: [event],
  });
  expect(confirmed.mock.calls[1][0].events).toEqual([]);
});
// 확정 효과 전에 이전 화면을 유지하고 이름 메타데이터와 최근 200개 제한을 보관한다.
it('keeps bounded named event metadata without mutating wire events and clears it for a new tournament', async () => {
  const x = setup();
  await x.enter();
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: null,
    state: {
      ...(structuredClone(playing.response) as RoomSnapshot),
      stateVersion: x.c.getView().snapshot!.stateVersion + 1,
    },
    events: [],
  });
  const before = x.c.getView().snapshot!;
  const next = { ...before, stateVersion: before.stateVersion + 1 };
  const events = Array.from({ length: 201 }, (_, n) => ({
    id: `e${n}`,
    type: 'CHECK',
    tournamentId: next.tournamentId!,
    hand: 1,
    at: '',
    details: { playerId: 'p0' },
  }));
  const confirmed = vi.fn(() => expect(x.c.getView().snapshot).toBe(before));
  x.c.onConfirmed(confirmed);
  x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: before.stateVersion, state: next, events });
  expect(confirmed).toHaveBeenCalledOnce();
  expect(x.c.getView().snapshot).toBe(next);
  expect(x.c.getKnownEvents().size).toBe(200);
  expect(x.c.getKnownEvents().has('e0')).toBe(false);
  expect(x.c.getKnownEvents().get('e1')?.event).toBe(events[1]);
  expect(x.c.getKnownEvents().get('e1')?.actorName).toBe('Alice');
  expect(events[1].details).toEqual({ playerId: 'p0' });
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: null,
    state: { ...next, tournamentId: 'different', stateVersion: 0 },
    events: [],
  });
  expect(x.c.getKnownEvents().size).toBe(0);
});
// 서버 기록 응답의 이벤트와 쿼리 및 만료된 토너먼트 처리를 확인한다.
it('loads room history with pagination and returns no events on 410', async () => {
  const x = setup();
  await x.enter();
  const events = [{ sequence: 1, type: 'CALL' }];
  x.api.get.mockResolvedValueOnce({ ok: true, body: { events, nextAfter: 1 } });
  expect(await x.c.loadEvents('t/a', 0, 100)).toEqual(events);
  const requested = x.api.get.mock.lastCall![0] as string;
  const url = new URL(requested, 'http://localhost');
  expect(url.pathname).toBe(`/api/rooms/${x.c.getView().snapshot!.roomId}/history`);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    tournamentId: 't/a',
    after: '0',
    limit: '100',
  });
  x.api.get.mockResolvedValueOnce({ ok: false, status: 410, code: 'TOURNAMENT_CHANGED' });
  expect(await x.c.loadEvents('old', 10, 50)).toEqual([]);
  x.api.get.mockResolvedValueOnce({ ok: false, unknown: true });
  await expect(x.c.loadEvents('t', 0, 10)).rejects.toThrow('기록을 불러오지 못했습니다.');
});
// 세션 초기화 실패가 재입력 가능한 단계로 돌아가는지 확인한다.
it('returns an initial connection failure to entry', async () => {
  const x = setup();
  x.api.open.mockRejectedValueOnce(new Error('offline'));
  expect(await x.c.create('Alice')).toBe(false);
  expect(x.c.getView().phase).toBe('entry');
  expect(x.c.getView().error).toBeTruthy();
});
// 복귀 실패가 입장 화면과 저장 상태를 함께 복원하는지 확인한다.
it('returns failed resume to entry and clears the saved room', async () => {
  const x = setup();
  localStorage.setItem('online.lastRoom', JSON.stringify({ roomId: 'missing' }));
  sessionStorage.setItem('online.controlRoom', 'missing');
  x.api.get.mockResolvedValueOnce({ ok: false, status: 404, code: 'ROOM_NOT_FOUND' });
  expect(await x.c.resume()).toBe(false);
  expect(x.c.getView().phase).toBe('entry');
  expect(x.c.getView().error).toBe('방을 찾을 수 없습니다.');
  expect(localStorage.getItem('online.lastRoom')).toBeNull();
  expect(sessionStorage.getItem('online.controlRoom')).toBeNull();
});
// 복구 종료 사유를 입장 화면에 보존하고 새 요청을 허용하는지 확인한다.
it.each(['REJECTED', 'EXPIRED', 'SUPERSEDED'])(
  'returns %s recovery to entry with a reason',
  async (status) => {
    const x = setup();
    x.api.post.mockResolvedValueOnce({
      ok: true,
      body: { recoveryRequestId: 'r', status: 'PENDING', expiresAt: 'later' },
    });
    x.api.get.mockResolvedValueOnce({ ok: true, body: { recoveryRequestId: 'r', status } });
    await x.c.requestRecovery('abc234', 'Alice');
    await Promise.resolve();
    expect(x.c.getView().phase).toBe('entry');
    expect(x.c.getView().error).toBeTruthy();
    expect(x.c.getView().recovery?.status).toBe(status);
    expect(await x.c.create('Alice')).toBe(true);
  },
);
// 테스트가 만든 컨트롤러와 전역 환경을 정리한다.
afterEach(() => {
  controllers.forEach((c) => c.dispose());
  controllers.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
// 브라우저 저장소와 소켓을 대신하는 세션 하네스를 만든다.
function setup() {
  const local = new Map<string, string>();
  const tab = new Map<string, string>();
  // 메모리 저장소에 브라우저 저장소 인터페이스를 부여한다.
  const storage = (map: Map<string, string>) => ({
    // 저장된 문자열을 조회한다.
    getItem: (k: string) => map.get(k) ?? null,
    // 지정한 키에 문자열을 저장한다.
    setItem: (k: string, v: string) => map.set(k, v),
    // 지정한 키를 제거한다.
    removeItem: (k: string) => map.delete(k),
  });
  vi.stubGlobal('localStorage', storage(local));
  vi.stubGlobal('sessionStorage', storage(tab));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  const entry = structuredClone(fixture.response) as JoinResponse;
  const api = {
    streamId: 'stream',
    // 외부 세션 준비를 대신한다.
    open: vi.fn(async () => {}),
    // 외부 스트림 삭제를 대신한다.
    closeStream: vi.fn(async () => {}),
    // 외부 세션 갱신을 대신한다.
    refresh: vi.fn(async () => ({ ok: true })),
    // 입장 응답을 반환하는 HTTP 경계를 대신한다.
    post: vi.fn(async (path: string, body: unknown): Promise<unknown> => {
      void path;
      void body;
      return { ok: true, status: 200, body: entry };
    }),
    get: vi.fn(),
  };
  let handlers!: RoomSocketHandlers;
  const socket = { subscribe: vi.fn(), resync: vi.fn(), close: vi.fn() };
  const c = new OnlineController(api as never, (h) => {
    handlers = h;
    return socket;
  });
  controllers.push(c);
  // 방에 입장하고 구독 상태를 동기화한다.
  const enter = async () => {
    await c.create('Alice');
    handlers.onState('open');
    handlers.onSnapshot({
      type: 'SNAPSHOT',
      previousVersion: null,
      events: [],
      state: entry.state,
    });
  };
  return {
    c,
    api,
    socket,
    entry,
    enter,
    get h() {
      return handlers;
    },
  };
}
// 응답을 잃어도 최신 스냅샷만으로 요청을 확정하지 않는다.
it('resolves an unknown command from the ledger without resending', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockResolvedValueOnce({ ok: false, unknown: true } as never);
  expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(false);
  expect(x.c.getView().pending).toBe(true);
  expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(false);
  const body = x.api.post.mock.calls.at(-1)![1] as unknown as {
    requestId: string;
    sequence: number;
  };
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: null,
    events: [],
    state: { ...x.entry.state, stateVersion: 20 },
  });
  expect(x.c.getView().pending).toBe(true);
  x.api.get.mockResolvedValueOnce({
    ok: true,
    body: {
      ...body,
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: 1,
      latestState: x.entry.state,
    },
  });
  x.h.onState('waiting');
  x.h.onState('open');
  await x.c.retry();
  expect(x.c.getView().pending).toBe(false);
  expect(x.api.post).toHaveBeenCalledTimes(2);
  expect(x.c.getView().snapshot?.stateVersion).toBe(20);
});
// 원장에 없는 요청은 최초 본문 그대로 재전송한다.
it('resends exactly the saved command only when absent', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockResolvedValueOnce({ ok: false, unknown: true } as never);
  await x.c.send([{ type: 'START', handScoped: false }]);
  const body = x.api.post.mock.calls.at(-1)![1];
  x.api.get.mockResolvedValueOnce({ ok: false, code: 'REQUEST_NOT_FOUND' });
  x.api.post.mockResolvedValueOnce({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: 2,
      latestState: x.entry.state,
    },
  } as never);
  await x.c.retry();
  expect(x.api.post.mock.calls.at(-1)![1]).toEqual(body);
  expect(x.c.getView().pending).toBe(false);
});
// 버전 비교와 효과 조건 및 토너먼트 교체를 확인한다.
it('merges tuples and emits effects only for consecutive versions', async () => {
  const x = setup();
  await x.enter();
  const effect = vi.fn();
  x.c.onConfirmed(effect);
  const next = { ...x.entry.state, stateVersion: 5 };
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: x.entry.state.stateVersion,
    events: [],
    state: next,
  });
  expect(effect).toHaveBeenCalledTimes(1);
  x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: null, events: [], state: x.entry.state });
  expect(x.c.getView().snapshot).toEqual(next);
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: 5,
    events: [],
    state: { ...next, stateVersion: 8 },
  });
  expect(effect).toHaveBeenCalledTimes(2);
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: null,
    events: [],
    state: { ...next, tournamentId: 'new', stateVersion: 0 },
  });
  expect(x.c.getView().snapshot?.stateVersion).toBe(0);
});
// 종료 후 늦게 도착하는 응답이 방을 다시 열지 않는지 확인한다.
it('ignores entry completions after leaving and cleans resources', async () => {
  const x = setup();
  let resolve!: (v: never) => void;
  x.api.post.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const work = x.c.create('Alice');
  await Promise.resolve();
  await Promise.resolve();
  x.c.leaveRoomScreen();
  resolve({ ok: true, body: x.entry } as never);
  await work;
  expect(x.c.getView().phase).toBe('entry');
  expect(x.api.closeStream).toHaveBeenCalled();
});
// 초안 병합 중에도 일반 명령이 최신 초안을 추월하지 않게 한다.
it('coalesces drafts and orders the ordinary request after them', async () => {
  const x = setup();
  await x.enter();
  let resolve!: (value: unknown) => void;
  x.api.post.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  // 실제 요청 필드를 서버 확정 응답으로 되돌린다.
  x.api.post.mockImplementation(async (_path, body) => ({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: 2,
      latestState: x.entry.state,
    },
  }));
  x.c.sendDraft(0, {});
  x.c.sendDraft(1, {});
  x.c.sendDraft(2, {});
  expect(x.c.getView().pending).toBe(false);
  const ordinary = x.c.send([{ type: 'START', handScoped: false }]);
  const first = x.api.post.mock.calls[1][1];
  resolve({
    ok: true,
    body: {
      ...(first as object),
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: 1,
      latestState: x.entry.state,
    },
  });
  expect(await ordinary).toBe(true);
  expect(x.api.post.mock.calls.slice(1).map(([, b]) => (b as { type: string }).type)).toEqual([
    'SETTLEMENT_DRAFT',
    'SETTLEMENT_DRAFT',
    'START',
  ]);
  expect((x.api.post.mock.calls[2][1] as { payload: { potIndex: number } }).payload.potIndex).toBe(
    2,
  );
});
// 조작권 원장과 게임 명령 원장의 순번이 독립적인지 확인한다.
it('takes a new generation with stream sequence two and command sequence one', async () => {
  const x = setup();
  await x.enter();
  const state = {
    ...x.entry.state,
    stateVersion: 2,
    you: { ...x.entry.state.you, controlGeneration: 3 },
  };
  x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: null, events: [], state });
  expect(x.c.getView().hasControl).toBe(false);
  x.api.post.mockImplementationOnce(async (_path, body) => ({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      controlGeneration: 4,
      latestState: { ...state, you: { ...state.you, controlGeneration: 4 } },
    },
  }));
  expect(await x.c.takeControl()).toBe(true);
  expect(x.api.post.mock.calls[1][1]).toMatchObject({ sequence: 2, expectedControlGeneration: 3 });
  x.api.post.mockImplementationOnce(async (_path, body) => ({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: 2,
      latestState: null,
    },
  }));
  await x.c.send([{ type: 'START', handScoped: false }]);
  expect(x.api.post.mock.calls[2][1]).toMatchObject({ sequence: 1, controlGeneration: 4 });
});
// 끊긴 연결의 복구가 스냅샷 수신 전에 조작을 허용하지 않게 한다.
it('keeps a reopened socket syncing until a snapshot arrives', async () => {
  const x = setup();
  await x.enter();
  x.h.onState('waiting');
  x.h.onState('open');
  expect(x.c.getView().connection).toBe('syncing');
  expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(false);
});
// 입장 결과 불명 요청을 새 식별자로 바꾸지 않는다.
it('retries entry on its original stream without room ledger lookup', async () => {
  const x = setup();
  x.api.post.mockResolvedValueOnce({ ok: false, unknown: true });
  await x.c.join('ABCDEF', 'Alice');
  const body = x.api.post.mock.calls[0][1];
  await x.c.retry();
  expect(x.api.post.mock.calls[1][1]).toEqual(body);
  expect(x.api.open).toHaveBeenCalledTimes(1);
  expect(x.api.get).not.toHaveBeenCalled();
  expect(x.c.getView().phase).toBe('room');
});
// 세션 표시가 없는 탭은 조회 화면으로만 복귀한다.
it('resumes without control when the tab marker is absent', async () => {
  const x = setup();
  localStorage.setItem(
    'online.lastRoom',
    JSON.stringify({ roomId: x.entry.roomId, code: x.entry.code }),
  );
  x.api.get.mockResolvedValueOnce({ ok: true, body: x.entry.state });
  await x.c.resume();
  expect(x.c.getView().hasControl).toBe(false);
  expect(x.api.post).not.toHaveBeenCalled();
});
// 복구 조회를 삼 초마다 실행하고 승인 응답의 세대를 사용한다.
it('polls recovery and accepts the generation from approval', async () => {
  vi.useFakeTimers();
  const x = setup();
  x.api.post.mockResolvedValueOnce({
    ok: true,
    body: { recoveryRequestId: 'recover', status: 'PENDING', expiresAt: 'later' },
  });
  x.api.get.mockResolvedValueOnce({
    ok: true,
    body: { recoveryRequestId: 'recover', status: 'PENDING' },
  });
  await x.c.requestRecovery('ABCDEF', 'Alice');
  await Promise.resolve();
  expect(x.c.getView().phase).toBe('recovering');
  x.api.get.mockResolvedValueOnce({
    ok: true,
    body: {
      ...x.entry,
      controlGeneration: 8,
      state: { ...x.entry.state, you: { ...x.entry.state.you, controlGeneration: 8 } },
      recoveryRequestId: 'recover',
      status: 'APPROVED',
    },
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect(x.c.getView().phase).toBe('room');
  expect(x.c.getView().hasControl).toBe(true);
});
// 마지막 서버 메시지가 해당 화면 단계와 채널 종료를 결정한다.
it.each([
  ['ROOM_GONE', 'gone'],
  ['ACCESS_REVOKED', 'revoked'],
  ['PROTOCOL_INCOMPATIBLE', 'incompatible'],
] as const)('stops on %s', async (type, phase) => {
  const x = setup();
  await x.enter();
  x.h.onFinal(type);
  expect(x.c.getView().phase).toBe(phase);
  expect(x.socket.close).toHaveBeenCalled();
  expect(x.api.closeStream).toHaveBeenCalled();
});
// 거절 응답은 최신 상태를 적용하고 명령 목록을 중단한다.
it('applies STALE_STATE and stops the remaining commands', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockImplementationOnce(async (_path, body) => ({
    ok: false,
    code: 'STALE_STATE',
    body: {
      ...(body as object),
      outcome: 'REJECTED',
      code: 'STALE_STATE',
      resultStateVersion: 4,
      latestState: { ...x.entry.state, stateVersion: 4 },
    },
  }));
  expect(
    await x.c.send([
      { type: 'START', handScoped: false },
      { type: 'START', handScoped: false },
    ]),
  ).toBe(false);
  expect(x.c.getView().snapshot?.stateVersion).toBe(4);
  expect(x.api.post).toHaveBeenCalledTimes(2);
});
// 원장 순번 오류가 새 조작 세대를 발급하고 다음 순번을 초기화하는지 확인한다.
it('resyncs and repairs the generation after SEQUENCE_GAP', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockImplementationOnce(async (_path, body) => ({
    ok: false,
    body: {
      ...(body as object),
      outcome: 'REJECTED',
      code: 'SEQUENCE_GAP',
      resultStateVersion: 1,
      latestState: x.entry.state,
    },
  }));
  x.api.post.mockImplementationOnce(async (_path, body) => ({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      code: 'OK',
      controlGeneration: 2,
      latestState: { ...x.entry.state, you: { ...x.entry.state.you, controlGeneration: 2 } },
    },
  }));
  expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(false);
  expect(x.socket.resync).toHaveBeenCalled();
  expect(x.c.getView().hasControl).toBe(true);
  expect(x.c.getView().connection).toBe('syncing');
});
// 서버가 다른 세대의 응답을 주면 조작권을 잘못 얻지 않는다.
it('retains unknown control when the response belongs to another request', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockResolvedValueOnce({
    ok: true,
    body: {
      requestId: 'wrong',
      sequence: 99,
      outcome: 'APPLIED',
      code: 'OK',
      controlGeneration: 2,
      latestState: { ...x.entry.state, you: { ...x.entry.state.you, controlGeneration: 2 } },
    },
  });
  expect(await x.c.takeControl()).toBe(false);
  expect(x.c.getView().pending).toBe(true);
});
// 화면을 떠난 이후의 조작권 응답이 권한을 복원하지 않게 한다.
it('ignores late control responses after leaving', async () => {
  const x = setup();
  await x.enter();
  let resolve!: (value: unknown) => void;
  x.api.post.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const work = x.c.takeControl();
  const body = x.api.post.mock.calls[1][1];
  x.c.leaveRoomScreen();
  resolve({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      controlGeneration: 2,
      latestState: { ...x.entry.state, you: { ...x.entry.state.you, controlGeneration: 2 } },
    },
  });
  expect(await work).toBe(false);
  expect(x.c.getView().phase).toBe('entry');
  expect(x.c.getView().hasControl).toBe(false);
});
// 종료된 복구 조회가 방을 열거나 다음 조회를 예약하지 않게 한다.
it('ignores late recovery approval and removes polling after leaving', async () => {
  vi.useFakeTimers();
  const x = setup();
  let resolve!: (value: unknown) => void;
  x.api.post.mockResolvedValueOnce({
    ok: true,
    body: { recoveryRequestId: 'recover', status: 'PENDING', expiresAt: 'later' },
  });
  x.api.get.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await x.c.requestRecovery('ABCDEF', 'Alice');
  x.c.leaveRoomScreen();
  resolve({ ok: true, body: { ...x.entry, recoveryRequestId: 'recover', status: 'APPROVED' } });
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(12000);
  expect(x.c.getView().phase).toBe('entry');
  expect(x.c.getView().hasControl).toBe(false);
  expect(x.api.get).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
// 세션 유지 타이머와 복귀 이벤트가 화면 수명에만 존재하는지 확인한다.
it('refreshes on six hours and visible return and stops on dispose', async () => {
  vi.useFakeTimers();
  const x = setup();
  await x.enter();
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  expect(x.api.refresh).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(x.api.refresh).toHaveBeenCalledTimes(2);
  x.c.dispose();
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  expect(x.api.refresh).toHaveBeenCalledTimes(2);
});
// 이전 스트림 준비가 끝나기 전에 새 스트림을 열지 않는다.
it('serializes old stream cleanup before a replacement entry', async () => {
  const x = setup();
  let resolve!: () => void;
  x.api.open.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const first = x.c.create('Alice');
  await Promise.resolve();
  x.c.leaveRoomScreen();
  const second = x.c.create('Bob');
  await Promise.resolve();
  expect(x.api.open).toHaveBeenCalledTimes(1);
  resolve();
  await first;
  await second;
  expect(x.api.open).toHaveBeenCalledTimes(2);
  expect(x.c.getView().phase).toBe('room');
});
// 종료된 화면의 응답을 기다리지 않고 새 방의 명령을 시작할 수 있어야 한다.
it('starts replacement room commands while an old request is unresolved', async () => {
  const x = setup();
  await x.enter();
  let finishOld!: (value: unknown) => void;
  x.api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const old = x.c.send([{ type: 'START', handScoped: false }]);
  x.c.leaveRoomScreen();
  await x.enter();
  x.api.post.mockImplementationOnce(async (_path, body) => ({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: 1,
      latestState: x.entry.state,
    },
  }));
  expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(true);
  finishOld({ ok: false, unknown: true });
  await old;
});
// 이전 화면의 완료 처리가 새 화면에서 초안을 기다리는 명령 잠금을 해제하지 않아야 한다.
it('keeps the replacement send guard when an old command completes', async () => {
  const x = setup();
  await x.enter();
  let finishOld!: (value: unknown) => void;
  let finishDraft!: (value: unknown) => void;
  x.api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const old = x.c.send([{ type: 'START', handScoped: false }]);
  x.c.leaveRoomScreen();
  await x.enter();
  x.api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishDraft = resolve;
      }),
  );
  x.c.sendDraft(0, {});
  expect(x.api.post.mock.calls.at(-1)![1]).toMatchObject({ type: 'SETTLEMENT_DRAFT' });
  const draft = x.api.post.mock.calls.at(-1)![1];
  const current = x.c.send([{ type: 'START', handScoped: false }]);
  finishOld({ ok: false, unknown: true });
  await old;
  x.c.sendDraft(9, {});
  x.api.post.mockImplementation(async (_path, body) => ({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: 1,
      latestState: x.entry.state,
    },
  }));
  finishDraft({
    ok: true,
    body: {
      ...(draft as object),
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: 1,
      latestState: x.entry.state,
    },
  });
  expect(await current).toBe(true);
  expect(x.api.post.mock.calls.slice(3).map(([, body]) => (body as { type: string }).type)).toEqual(
    ['SETTLEMENT_DRAFT', 'START'],
  );
});
// 결과 불명 초안은 화면을 잠그고 확정 원장 조회 이후에만 잠금을 해제한다.
it.each([false, true])(
  'locks an unknown draft until ledger resolution, missing=%s',
  async (missing) => {
    const x = setup();
    await x.enter();
    x.api.post.mockResolvedValueOnce({ ok: false, unknown: true });
    x.c.sendDraft(0, {});
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const body = x.api.post.mock.calls.at(-1)![1];
    expect(x.c.getView().pending).toBe(true);
    expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(false);
    x.h.onSnapshot({
      type: 'SNAPSHOT',
      previousVersion: null,
      events: [],
      state: { ...x.entry.state, stateVersion: 9 },
    });
    expect(x.c.getView().pending).toBe(true);
    const confirmed = {
      ok: true,
      body: {
        ...(body as object),
        outcome: 'APPLIED',
        code: 'OK',
        resultStateVersion: 1,
        latestState: x.entry.state,
      },
    };
    x.api.get.mockResolvedValueOnce(missing ? { ok: false, code: 'REQUEST_NOT_FOUND' } : confirmed);
    if (missing) x.api.post.mockResolvedValueOnce(confirmed);
    expect(await x.c.retry()).toBe(true);
    expect(x.c.getView().pending).toBe(false);
    expect(x.api.post).toHaveBeenCalledTimes(missing ? 3 : 2);
    if (missing) expect(x.api.post.mock.calls.at(-1)![1]).toEqual(body);
  },
);
// 일반 명령이 기다리던 초안의 결과가 불명이어도 잠금을 유지한다.
it('keeps unknown draft pending after a waiting ordinary send stops', async () => {
  const x = setup();
  await x.enter();
  let finishDraft!: (value: unknown) => void;
  x.api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishDraft = resolve;
      }),
  );
  x.c.sendDraft(0, {});
  const ordinary = x.c.send([{ type: 'START', handScoped: false }]);
  finishDraft({ ok: false, unknown: true });
  expect(await ordinary).toBe(false);
  expect(x.c.getView().pending).toBe(true);
  expect(x.api.post).toHaveBeenCalledTimes(2);
});
// 연결이나 조작권을 잃으면 아직 보내지 않은 초안은 폐기한다.
it.each(['disconnect', 'control'] as const)(
  'discards queued drafts after %s',
  async (transition) => {
    const x = setup();
    await x.enter();
    let finishDraft!: (value: unknown) => void;
    x.api.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDraft = resolve;
        }),
    );
    x.c.sendDraft(0, {});
    x.c.sendDraft(1, {});
    const body = x.api.post.mock.calls.at(-1)![1];
    if (transition === 'disconnect') x.h.onState('waiting');
    else
      x.h.onSnapshot({
        type: 'SNAPSHOT',
        previousVersion: null,
        events: [],
        state: { ...x.entry.state, you: { ...x.entry.state.you, controlGeneration: 2 } },
      });
    x.api.post.mockImplementation(async (_path, request) => ({
      ok: true,
      body: {
        ...(request as object),
        outcome: 'APPLIED',
        code: 'OK',
        resultStateVersion: 1,
        latestState: x.entry.state,
      },
    }));
    finishDraft({
      ok: true,
      body: {
        ...(body as object),
        outcome: 'APPLIED',
        code: 'OK',
        resultStateVersion: 1,
        latestState: null,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(x.api.post).toHaveBeenCalledTimes(2);
    x.h.onState('open');
    x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: null, events: [], state: x.entry.state });
    await Promise.resolve();
    expect(x.api.post).toHaveBeenCalledTimes(2);
  },
);

// 나가기 응답과 권한 회수 소켓의 순서가 달라도 방과 탭 표시를 함께 정리한다.
it.each([false, true])('clears membership markers on LEAVE when revocation arrives first=%s', async (revokedFirst) => {
  const x = setup();
  await x.enter();
  x.api.post.mockImplementationOnce(async (_path, raw) => {
    const body = raw as { requestId: string; sequence: number };
    if (revokedFirst) x.h.onFinal('ACCESS_REVOKED');
    return { ok: true, status: 200, body: { requestId: body.requestId, sequence: body.sequence, outcome: 'APPLIED', code: 'OK', resultStateVersion: 2, latestState: null } };
  });
  await x.c.send([{ type: 'LEAVE', handScoped: false }]);
  expect(x.c.getView().phase).toBe('entry');
  expect(x.c.getView().snapshot).toBeNull();
  expect(localStorage.getItem('online.lastRoom')).toBeNull();
  expect(sessionStorage.getItem('online.controlRoom')).toBeNull();
});
