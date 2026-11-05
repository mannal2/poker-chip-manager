import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../../shared/api-contract/create-room.json';
import playing from '../../../shared/api-contract/snapshot-playing.json';
import { OnlineController } from '../../src/features/online-game/session/onlineController';
import { ApiClient, ApiOpenError } from '../../src/features/online-game/api/client';
import type { RoomSocketHandlers } from '../../src/features/online-game/realtime/roomSocket';
import type { JoinResponse, RoomSnapshot } from '../../src/features/online-game/api/types';

// HTTP와 소켓의 도착 순서가 달라도 최근 토너먼트와 재준비 상태를 보존한다
it.each(['START', 'RE_READY'] as const)(
  'preserves dispatch scope across late %s replies and accepts HTTP-first transitions',
  async (type) => {
    for (const delivery of ['http', 'ws', 'superseded']) {
      const x = setup();
      await x.enter();
      const game = structuredClone(playing.response) as RoomSnapshot;
      const waiting = {
        ...x.entry.state,
        stateVersion: type === 'START' ? game.stateVersion + 10 : 0,
      };
      const before = type === 'START' ? waiting : game;
      const after = type === 'START' ? game : waiting;
      const newerScope =
        type === 'START'
          ? waiting
          : {
              ...game,
              tournamentId: 'second-tournament',
              game: { ...game.game!, tournamentId: 'second-tournament' },
            };
      // 소켓으로 토너먼트 경계의 전체 상태를 발행한다
      const publish = (state: RoomSnapshot) =>
        x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: null, events: [], state });
      publish(before);
      let deliver!: () => void;
      // 원래 요청 식별자와 함께 서버 응답을 원하는 순서에 맞춰 반환한다
      x.api.post.mockImplementationOnce(
        (_path, body) =>
          new Promise((resolve) => {
            // 보류한 명령의 확정 결과를 전달한다
            deliver = () =>
              resolve({
                ok: true,
                body: {
                  ...(body as object),
                  outcome: 'APPLIED',
                  code: 'OK',
                  resultStateVersion: after.stateVersion,
                  latestState: after,
                },
              });
          }),
      );
      const work = x.c.send([{ type, handScoped: false }]);
      if (delivery !== 'http') publish(after);
      if (delivery === 'superseded') publish(newerScope);
      deliver();
      expect(await work).toBe(true);
      expect(x.c.getView().snapshot).toEqual(delivery === 'superseded' ? newerScope : after);
      expect(x.c.getView().pending).toBe(false);
      if (delivery === 'http') publish(after);
      x.c.dispose();
    }
  },
);

// 관전 중 인수가 토너먼트 전환과 겹쳐도 이 탭이 받은 세대를 서버가 확인하면 명령을 허용한다
it.each(['START', 'RE_READY'])(
  'recognizes its granted generation after a concurrent %s publication',
  async (type) => {
    const x = setup();
    const playingState = structuredClone(playing.response) as RoomSnapshot;
    const before = type === 'START' ? x.entry.state : playingState;
    const after = type === 'START' ? playingState : x.entry.state;
    // 같은 자리에 대해 전환 전후의 조작 세대를 발행한다
    const withGeneration = (state: RoomSnapshot, generation: number) => ({
      ...state,
      you: { ...state.you, controlGeneration: generation },
    });
    // 전환 및 인수를 알리는 전체 상태를 현재 소켓으로 수신한다
    const publish = (state: RoomSnapshot) =>
      x.h.onSnapshot({ type: 'SNAPSHOT', state, previousVersion: null, events: [] });
    localStorage.setItem(
      'online.lastRoom',
      JSON.stringify({ roomId: before.roomId, code: before.code }),
    );
    x.api.get.mockResolvedValueOnce({ ok: true, body: withGeneration(before, 2) });
    expect(await x.c.resume()).toBe(true);
    publish(withGeneration(before, 2));
    expect(x.c.getView().hasControl).toBe(false);

    let deliver!: (reply: unknown) => void;
    // 기존 세대에서 보낸 인수의 HTTP 응답을 전환 발행 뒤로 늦춘다
    x.api.post.mockReturnValueOnce(
      new Promise((resolve) => {
        deliver = resolve;
      }),
    );
    const takeover = x.c.takeControl();
    const request = x.api.post.mock.lastCall![1] as object;
    publish(withGeneration(after, 2));
    const displayed = x.c.getView().snapshot!;
    const granted = withGeneration(structuredClone(after), 3);
    deliver({
      ok: true,
      body: { ...request, outcome: 'APPLIED', controlGeneration: 3, latestState: granted },
    });
    expect(await takeover).toBe(true);
    expect(x.c.getView().snapshot?.tournamentId).toBe(after.tournamentId);
    expect(x.c.getView().snapshot?.participants).toBe(displayed.participants);
    expect(x.c.getView().snapshot?.game).toBe(displayed.game);
    expect(x.c.getView()).toMatchObject({
      hasControl: true,
      snapshot: { you: { controlGeneration: 3 } },
    });
    publish(granted);
    expect(x.c.getView()).toMatchObject({
      hasControl: true,
      pending: false,
      snapshot: { you: { controlGeneration: 3 } },
    });

    // 첫 게임 명령은 이 탭이 새로 받은 세대와 독립 순번을 사용한다
    x.api.post.mockImplementationOnce(async (_path, body) => ({
      ok: true,
      body: {
        ...(body as object),
        outcome: 'APPLIED',
        code: 'OK',
        resultStateVersion: granted.stateVersion,
        latestState: granted,
      },
    }));
    expect(
      await x.c.send([{ type: type === 'START' ? 'CALL' : 'START', handScoped: type === 'START' }]),
    ).toBe(true);
    expect(x.api.post.mock.lastCall![1]).toMatchObject({ controlGeneration: 3, sequence: 1 });
    publish(withGeneration(after, 4));
    expect(x.c.getView().hasControl).toBe(false);
  },
);
// 늦게 온 인수 성공 응답이 다른 탭에서 이미 얻은 더 높은 세대를 되돌리지 않는다
it('retains observed generation three after a delayed generation two takeover', async () => {
  const x = setup();
  await x.enter();
  // 동일 버전에서 조작 세대만 달라진 상태를 만든다
  const state = (generation: number) => ({
    ...x.entry.state,
    you: { ...x.entry.state.you, controlGeneration: generation },
  });
  let finish!: () => void;
  // 원래 화면이 발급받은 세대의 HTTP 응답을 지연한다
  x.api.post.mockImplementationOnce(
    (_path, body) =>
      new Promise((resolve) => {
        // 이전 인수의 확정 결과를 나중에 전달한다
        finish = () =>
          resolve({
            ok: true,
            body: {
              ...(body as object),
              outcome: 'APPLIED',
              controlGeneration: 2,
              latestState: state(2),
            },
          });
      }),
  );
  const work = x.c.takeControl();
  x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: null, events: [], state: state(3) });
  finish();
  expect(await work).toBe(true);
  expect(x.c.getView()).toMatchObject({
    hasControl: false,
    pending: false,
    snapshot: { you: { controlGeneration: 3 } },
  });
});

// 실제 HTTP 분류와 입장 원장이 방 한도 거절을 확정하고 다음 입력에 새 식별자를 발급한다
it('unlocks a recorded 503 ROOM_LIMIT and preserves ambiguous 5xx requests', async () => {
  const x = setup(new ApiClient());
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ csrfToken: 'token', protocolVersion: 1 }))
    .mockResolvedValueOnce(Response.json({ streamId: 'stream' }))
    .mockResolvedValueOnce(
      Response.json(
        { code: 'ROOM_LIMIT', message: '지금은 방을 더 만들 수 없습니다.' },
        { status: 503 },
      ),
    )
    .mockResolvedValueOnce(Response.json({ code: 'INTERNAL_ERROR' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ code: 'ROOM_LIMIT' }, { status: 500 }))
    .mockResolvedValueOnce(Response.json(x.entry));
  vi.stubGlobal('fetch', transport);
  expect(await x.c.create('Alice')).toBe(false);
  expect(x.c.getView()).toMatchObject({
    phase: 'entry',
    pending: false,
    error: '지금은 방을 더 만들 수 없습니다.',
  });
  expect(await x.c.create('Alice')).toBe(false);
  expect(x.c.getView().pending).toBe(true);
  expect(await x.c.retry()).toBe(false);
  expect(await x.c.retry()).toBe(true);
  const bodies = transport.mock.calls.slice(2).map((call) => JSON.parse(call[1].body));
  expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  expect(bodies.slice(1)).toEqual([bodies[1], bodies[1], bodies[1]]);
});

// 일시적인 복구 조회 실패는 재시도하고 확정 404는 사유를 남기며 중단한다
it.each(['ROOM_NOT_FOUND', 'REQUEST_NOT_FOUND'])(
  'stops polling after terminal recovery 404 %s',
  async (code) => {
    vi.useFakeTimers();
    const x = setup();
    x.api.post.mockResolvedValueOnce({
      ok: true,
      body: { recoveryRequestId: 'r', status: 'PENDING', expiresAt: 'later' },
    });
    x.api.get
      .mockResolvedValueOnce({ ok: false, unknown: true })
      .mockResolvedValueOnce({ ok: false, status: 404, code });
    await x.c.requestRecovery('ABC234', 'Alice');
    expect(x.c.getView().phase).toBe('recovering');
    await vi.advanceTimersByTimeAsync(3000);
    expect(x.c.getView()).toMatchObject({
      phase: 'entry',
      pending: false,
      recovery: null,
      error: code === 'ROOM_NOT_FOUND' ? '방을 찾을 수 없습니다.' : '복구 신청을 찾을 수 없습니다.',
    });
    await vi.advanceTimersByTimeAsync(9000);
    expect(x.api.get).toHaveBeenCalledTimes(2);
  },
);

// 응답 헤더나 본문이 멎어도 재접속한 화면은 원래 요청을 중복 전송하지 않고 조회한다
it.each(['fetch', 'body'])(
  'recovers the original command when %s stalls across reconnect',
  async (stage) => {
    vi.useFakeTimers();
    const x = setup(new ApiClient());
    const stalled = new Promise<never>(() => {});
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ csrfToken: 'token', protocolVersion: 1 }))
      .mockResolvedValueOnce(Response.json({ streamId: 'stream' }))
      .mockResolvedValueOnce(Response.json(x.entry))
      .mockImplementationOnce(() =>
        stage === 'fetch'
          ? stalled
          : {
              ok: true,
              status: 200,
              // 수신이 끝나지 않은 JSON 본문을 대신한다
              json: () => stalled,
            },
      );
    vi.stubGlobal('fetch', transport);
    await x.enter();
    const work = x.c.send([{ type: 'START', handScoped: false }]);
    const original = JSON.parse(transport.mock.calls[3][1].body);
    transport.mockResolvedValueOnce(
      Response.json({
        ...original,
        outcome: 'APPLIED',
        code: 'OK',
        resultStateVersion: 1,
        latestState: x.entry.state,
      }),
    );
    await vi.advanceTimersByTimeAsync(1);
    x.h.onState('waiting');
    x.h.onState('open');
    await vi.advanceTimersByTimeAsync(15000);
    expect(transport.mock.calls[3][1].signal?.aborted).toBe(true);
    expect(await work).toBe(false);
    expect(transport.mock.calls[4][0]).toBe(
      '/api/rooms/' + x.entry.roomId + '/requests/' + original.requestId,
    );
    expect(transport.mock.calls[4][1].method).toBe('GET');
    expect(transport).toHaveBeenCalledTimes(5);
    expect(x.c.getView().pending).toBe(false);
  },
);

// 초기 접속과 저장한 방 복귀에서 서버가 명시한 버전 불일치를 최종 화면으로 보낸다
it.each(['create', 'resume'])(
  'shows refresh-required on an incompatible %s handshake',
  async (path) => {
    const x = setup(new ApiClient());
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ csrfToken: 'token', protocolVersion: 2 }));
    vi.stubGlobal('fetch', fetch);
    localStorage.setItem('online.lastRoom', JSON.stringify({ roomId: 'room' }));
    expect(await (path === 'resume' ? x.c.resume() : x.c.create('Alice'))).toBe(false);
    expect(x.c.getView()).toMatchObject({ phase: 'incompatible', pending: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

// 연결 자체의 실패와 서버가 거절한 참가자 접속 상태를 구분한다
it('distinguishes transport failure from a disconnected participant rejection', async () => {
  const x = setup();
  x.api.open.mockRejectedValueOnce(new Error('network'));
  await x.c.create('Alice');
  expect(x.c.getView().error).toBe('서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.');
  await x.enter();
  x.api.post.mockResolvedValueOnce({ ok: false, status: 422, code: 'NOT_CONNECTED' });
  await x.c.send([{ type: 'START', handScoped: false }]);
  expect(x.c.getView().error).toBe('접속하지 않은 참가자가 있습니다.');
});

// LEAVE 결과를 잃은 뒤 원장에서 방을 찾지 못하면 자격 표식을 지우고 입장으로 돌아간다
it('completes an unknown LEAVE on ledger ROOM_NOT_FOUND without resending', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockResolvedValueOnce({ ok: false, unknown: true });
  await x.c.send([{ type: 'LEAVE', handScoped: false }]);
  const body = x.api.post.mock.lastCall![1] as { requestId: string };
  x.api.get.mockResolvedValueOnce({ ok: false, status: 404, code: 'ROOM_NOT_FOUND' });
  expect(await x.c.retry()).toBe(true);
  expect(x.api.get).toHaveBeenCalledExactlyOnceWith(
    '/api/rooms/' + x.entry.roomId + '/requests/' + body.requestId,
  );
  expect(x.api.post).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem('online.lastRoom')).toBeNull();
  expect(sessionStorage.getItem('online.controlRoom')).toBeNull();
  expect(x.c.getView()).toMatchObject({
    phase: 'entry',
    snapshot: null,
    pending: false,
    error: null,
  });
});

// 교체 구독의 낮은 버전은 입력을 풀지 않고 최신 스냅샷이 도착할 때까지 기다린다
it('keeps input locked when a reconnect receives a lower tuple', async () => {
  const x = setup();
  await x.enter();
  const state = x.c.getView().snapshot!;
  x.h.onState('open');
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: null,
    events: [],
    state: { ...state, stateVersion: state.stateVersion - 1 },
  });
  expect(x.c.getView().connection).toBe('syncing');
  x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: null, events: [], state });
  expect(x.c.getView().connection).toBe('online');
});
const controllers: OnlineController[] = [];
// HTTP 응답이 먼저 적용되어도 같은 버전의 확정 알림을 한 번 전달하고 취소가 아니면 효과를 재생한다
it.each(['CHECK', 'UNDO'])(
  'observes HTTP-first %s once and plays effects unless it is an undo',
  async (type) => {
    const x = setup();
    await x.enter();
    const next = {
      ...x.entry.state,
      stateVersion: x.entry.state.stateVersion + 1,
      draftVersion: 2,
    };
    const observed = vi.fn();
    const effect = vi.fn();
    x.c.onObserved(observed);
    x.c.onConfirmed(effect);
    x.api.post.mockImplementationOnce(async (_path, raw) => ({
      ok: true,
      body: {
        ...(raw as object),
        outcome: 'APPLIED',
        code: 'OK',
        resultStateVersion: next.stateVersion,
        latestState: next,
      },
    }));
    await x.c.send([{ type: 'CHECK', handScoped: true }]);
    const event = {
      id: type,
      type,
      at: '',
      tournamentId: next.tournamentId!,
      hand: 1,
      details: { playerId: 'p0', auto: type === 'CHECK' },
    };
    const events = [
      event,
      { ...event, id: 'auto-fold', type: 'FOLD', details: { playerId: 'p1', auto: true } },
    ];
    const message = {
      type: 'SNAPSHOT' as const,
      previousVersion: x.entry.state.stateVersion,
      events,
      state: next,
    };
    x.h.onSnapshot({ ...message, state: { ...next, draftVersion: 1 } });
    x.h.onSnapshot({ ...message, state: { ...next, stateVersion: next.stateVersion - 1 } });
    expect(observed).not.toHaveBeenCalled();
    expect(x.c.getKnownEvents().size).toBe(0);
    const confirmedState = x.c.getView().snapshot;
    x.h.onSnapshot({ ...message, state: structuredClone(next) });
    x.h.onSnapshot(message);
    expect(observed).toHaveBeenCalledExactlyOnceWith(events);
    expect(x.c.getKnownEvents().has(type)).toBe(true);
    expect(x.c.getView().snapshot).toEqual(confirmedState);
    expect(effect).toHaveBeenCalledTimes(type === 'CHECK' ? 1 : 0);
  },
);

// HTTP를 보내지 않는 관찰자는 같은 이벤트의 알림과 연속 효과를 각각 한 번 받는다
it('observes fresh and gap events independently from consecutive chip effects', async () => {
  const x = setup();
  await x.enter();
  const observed = vi.fn();
  const effect = vi.fn();
  x.c.onObserved(observed);
  x.c.onConfirmed(effect);
  const before = x.c.getView().snapshot!;
  const event = {
    id: 'check',
    type: 'CHECK',
    at: '',
    tournamentId: before.tournamentId!,
    hand: 1,
    details: { playerId: 'p0', auto: true },
  };
  const next = { ...before, stateVersion: before.stateVersion + 1 };
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: before.stateVersion,
    events: [event],
    state: next,
  });
  expect(observed).toHaveBeenCalledExactlyOnceWith([event]);
  expect(effect).toHaveBeenCalledOnce();
  x.h.onSnapshot({
    type: 'SNAPSHOT',
    previousVersion: next.stateVersion + 1,
    events: [{ ...event, id: 'gap' }],
    state: { ...next, stateVersion: next.stateVersion + 2 },
  });
  expect(observed).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledOnce();
});
// 결과 불명 요청이 없어도 수동 연결 버튼의 동작이 새 구독을 시작하는지 확인한다
it('reconnects an idle room without requiring a pending request', async () => {
  const x = setup();
  await x.enter();
  expect(x.c.getView().pending).toBe(false);
  x.c.reconnect();
  expect(x.socket.reconnect).toHaveBeenCalledOnce();
  expect(x.c.getView().connection).toBe('syncing');
  x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: null, events: [], state: x.entry.state });
  expect(x.c.getView().connection).toBe('online');
  expect(x.api.get).not.toHaveBeenCalled();
});
// BFCache 수명 동안 원장과 구독을 유지하고 같은 결과 불명 명령을 조회한다
it('preserves an unknown command across BFCache and releases the stream on document exit', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockResolvedValueOnce({ ok: false, unknown: true });
  await x.c.send([{ type: 'CHECK', handScoped: true }]);
  const body = x.api.post.mock.lastCall![1] as { requestId: string; sequence: number };
  const listener = vi.fn();
  x.c.subscribe(listener);
  x.c.suspend(true);
  expect(x.api.closeStream).not.toHaveBeenCalled();
  expect(x.c.getView().pending).toBe(true);
  expect(sessionStorage.getItem('online.controlRoom')).toBe(x.entry.roomId);
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
  x.c.restore();
  x.h.onState('open');
  await vi.waitFor(() => expect(x.c.getView().pending).toBe(false));
  expect(x.api.get).toHaveBeenCalledWith(expect.stringContaining(`/requests/${body.requestId}`));
  expect(x.api.post).toHaveBeenCalledTimes(2);
  expect(x.api.refresh).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalled();
  x.c.suspend(false);
  expect(x.api.closeStream).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem('online.controlRoom')).toBe(x.entry.roomId);
});
// 같은 발행 묶음과 후속 발행에 중복된 이벤트 ID의 효과를 한 번만 전달한다
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
// 확정 효과 전에 이전 화면을 유지하고 이름 메타데이터와 최근 200개 제한을 보관한다
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
// 서버 기록 응답의 이벤트와 쿼리 및 만료된 토너먼트 처리를 확인한다
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
// 세션 초기화 실패가 재입력 가능한 단계로 돌아가는지 확인한다
it('returns an initial connection failure to entry', async () => {
  const x = setup();
  x.api.open.mockRejectedValueOnce(new Error('offline'));
  expect(await x.c.create('Alice')).toBe(false);
  expect(x.c.getView().phase).toBe('entry');
  expect(x.c.getView().error).toBeTruthy();
});
// 복귀 실패가 입장 화면과 저장 상태를 함께 복원하는지 확인한다
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
// 복구 종료 사유를 입장 화면에 보존하고 새 요청을 허용하는지 확인한다
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
// 테스트가 만든 컨트롤러와 전역 환경을 정리한다
afterEach(() => {
  controllers.forEach((c) => c.dispose());
  controllers.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
// 브라우저 저장소와 소켓을 대신하는 세션 하네스를 만든다
function setup(client?: ApiClient) {
  const local = new Map<string, string>();
  const tab = new Map<string, string>();
  // 메모리 저장소에 브라우저 저장소 인터페이스를 부여한다
  const storage = (map: Map<string, string>) => ({
    // 저장된 문자열을 조회한다
    getItem: (k: string) => map.get(k) ?? null,
    // 지정한 키에 문자열을 저장한다
    setItem: (k: string, v: string) => map.set(k, v),
    // 지정한 키를 제거한다
    removeItem: (k: string) => map.delete(k),
  });
  vi.stubGlobal('localStorage', storage(local));
  vi.stubGlobal('sessionStorage', storage(tab));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  const entry = structuredClone(fixture.response) as JoinResponse;
  const api = {
    streamId: 'stream',
    // 외부 세션 준비를 대신한다
    open: vi.fn(async () => {}),
    // 외부 스트림 삭제를 대신한다
    closeStream: vi.fn(async () => {}),
    // 외부 세션 갱신을 대신한다
    refresh: vi.fn(async () => ({ ok: true })),
    // 입장 응답을 반환하는 HTTP 경계를 대신한다
    post: vi.fn(async (path: string, body: unknown): Promise<unknown> => {
      void path;
      void body;
      return { ok: true, status: 200, body: entry };
    }),
    get: vi.fn(),
  };
  let handlers!: RoomSocketHandlers;
  const socket = {
    subscribe: vi.fn(),
    resync: vi.fn(),
    close: vi.fn(),
    // 실제 전송 계층처럼 재접속을 시작하면서 입력을 잠근다
    reconnect: vi.fn(() => handlers.onState('connecting')),
  };
  const c = new OnlineController(client ?? (api as never), (h) => {
    handlers = h;
    return socket;
  });
  controllers.push(c);
  // 방에 입장하고 구독 상태를 동기화한다
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
    // 현재 연결에 등록된 소켓 핸들러를 제공한다
    get h() {
      return handlers;
    },
  };
}
// 빈도 제한 응답을 흉내 낸다
const rateLimited = { ok: false, unknown: true, code: 'RATE_LIMITED', retryAfter: 2 };

// 받은 명령을 그대로 적용한 서버 응답을 만든다
function applied(x: ReturnType<typeof setup>) {
  return (_path: string, body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      body: {
        ...(body as object),
        outcome: 'APPLIED',
        code: 'OK',
        resultStateVersion: x.entry.state.stateVersion,
        latestState: x.entry.state,
      },
    });
}

// 429 뒤에도 요청을 보관하고 재시도는 같은 식별자로 나가며 다음 순번은 하나만 늘어난다
it('keeps a rate limited command and retries it with the same id and sequence', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockResolvedValueOnce(rateLimited);
  expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(false);
  const first = x.api.post.mock.lastCall![1] as { requestId: string; sequence: number };
  expect(x.c.getView().pending).toBe(true);
  expect(x.c.canRetry()).toBe(true);
  expect(x.c.getView().error).toContain('2초');
  expect(x.c.getView().error).toContain('요청이 너무 많습니다');

  x.api.get.mockResolvedValueOnce({ ok: false, status: 404, code: 'REQUEST_NOT_FOUND' });
  x.api.post.mockImplementationOnce(applied(x));
  expect(await x.c.retry()).toBe(true);
  const second = x.api.post.mock.lastCall![1] as { requestId: string; sequence: number };
  expect(second).toEqual(first);
  expect(x.c.getView()).toMatchObject({ pending: false, error: null });

  x.api.post.mockImplementationOnce(applied(x));
  expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(true);
  const next = x.api.post.mock.lastCall![1] as { requestId: string; sequence: number };
  expect(next.sequence).toBe(first.sequence + 1);
  expect(next.requestId).not.toBe(first.requestId);
});

// 제한된 요청은 소켓이 다시 열려도 사용자가 누르기 전에는 다시 보내지 않는다
it('does not resend a rate limited command when the socket reopens', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockResolvedValueOnce(rateLimited);
  await x.c.send([{ type: 'START', handScoped: false }]);
  const posts = x.api.post.mock.calls.length;
  x.h.onState('open');
  await new Promise((resolve) => setTimeout(resolve));
  expect(x.api.get).not.toHaveBeenCalled();
  expect(x.api.post).toHaveBeenCalledTimes(posts);
  expect(x.c.canRetry()).toBe(true);
});

// 서버 이름 규칙에 맞지 않는 이름은 세션을 열거나 요청을 보내지 않고 입장 화면에서 거절한다
it.each(['', '   ', 'a!', '가나다라마바사아자차카'])(
  'rejects the name %j before any request',
  async (name) => {
    const x = setup();
    expect(await x.c.create(name)).toBe(false);
    expect(await x.c.join('ABC123', name)).toBe(false);
    expect(x.c.getView().error).toBe('이름은 한글, 영문, 숫자, 공백으로 1~10자여야 합니다.');
    expect(await x.c.requestRecovery('ABC234', name)).toBe(false);
    expect(x.api.open).not.toHaveBeenCalled();
    expect(x.api.post).not.toHaveBeenCalled();
    expect(x.c.getView()).toMatchObject({
      phase: 'entry',
      pending: false,
      error: '정확한 이름을 입력해주세요.',
    });
  },
);

it.each([
  '',
  '   ',
  'ABC23',
  'ABC2345',
  'ABC123',
  'ABO234',
  'ABI234',
  'ABL234',
  'AB한234',
  'AB!234',
])('rejects invalid recovery code %j before any request', async (code) => {
  const x = setup();
  expect(await x.c.requestRecovery(code, 'Alice')).toBe(false);
  expect(x.api.open).not.toHaveBeenCalled();
  expect(x.api.post).not.toHaveBeenCalled();
  expect(x.c.getView().error).toBe('정확한 방코드를 입력해주세요.');
});

it('checks the recovery name before the room code', async () => {
  const x = setup();
  expect(await x.c.requestRecovery('', '')).toBe(false);
  expect(x.api.open).not.toHaveBeenCalled();
  expect(x.c.getView().error).toBe('정확한 이름을 입력해주세요.');
});

it.each([
  ['RECOVERY_TARGET_NOT_FOUND', '해당 게임방에 Alice플레이어가 존재하지 않습니다.'],
  ['ROOM_NOT_FOUND', '방을 찾을 수 없습니다.'],
  ['ALREADY_PARTICIPANT', '이미 이 방에 참가하고 있습니다.'],
  ['RECOVERY_LIMIT', '이 자리의 복구 신청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.'],
])('shows recovery-specific guidance for %s', async (code, message) => {
  const x = setup();
  x.api.post.mockResolvedValueOnce({ ok: false, status: 404, code, body: {} });
  expect(await x.c.requestRecovery(' abc234 ', ' Alice ')).toBe(false);
  expect(x.api.post).toHaveBeenCalledWith(
    '/api/recovery-requests',
    expect.objectContaining({ code: 'ABC234', name: 'Alice' }),
  );
  expect(x.c.getView()).toMatchObject({ phase: 'entry', pending: false, error: message });
});

// 방 입장 요청도 제한되면 보관한 본문을 사용자가 재시도할 때만 다시 보낸다
it('keeps a rate limited entry until the person retries', async () => {
  const x = setup();
  x.api.post.mockResolvedValueOnce(rateLimited);
  expect(await x.c.create('Alice')).toBe(false);
  const first = x.api.post.mock.lastCall![1];
  expect(x.c.getView()).toMatchObject({ phase: 'joining', pending: true });
  x.c.restore();
  await new Promise((resolve) => setTimeout(resolve));
  expect(x.api.post).toHaveBeenCalledTimes(1);

  expect(await x.c.retry()).toBe(true);
  expect(x.api.post.mock.lastCall![1]).toEqual(first);
  expect(x.c.getView()).toMatchObject({ phase: 'room', error: null });
});

// 복구 신청을 제한 뒤 재시도해 접수되면 제한 안내를 지운다
it('clears the limit notice when a retried recovery request is accepted', async () => {
  const x = setup();
  x.api.post.mockResolvedValueOnce(rateLimited);
  expect(await x.c.requestRecovery('ABC234', 'Alice')).toBe(false);
  x.api.post.mockResolvedValueOnce({
    ok: true,
    status: 200,
    body: { recoveryRequestId: 'recovery', status: 'PENDING', expiresAt: 'later' },
  });
  x.api.get.mockReturnValue(new Promise(() => {}));
  expect(await x.c.retry()).toBe(true);
  expect(x.c.getView()).toMatchObject({ pending: false, error: null });
});

// 입장에서 세션 만료를 받으면 입장 화면에 남고 다음 시도는 새 세션으로 성공한다
it.each(['create', 'recovery'] as const)(
  'reopens a fresh session after NO_SESSION on %s',
  async (kind) => {
    const x = setup();
    localStorage.setItem('online.lastRoom', JSON.stringify({ roomId: 'r', code: 'c' }));
    // 입장 종류에 맞는 요청을 보낸다
    const attempt = () =>
      kind === 'create' ? x.c.create('Alice') : x.c.requestRecovery('ABC234', 'Alice');
    x.api.post.mockResolvedValueOnce({ ok: false, status: 401, code: 'NO_SESSION' });
    expect(await attempt()).toBe(false);
    expect(x.c.getView()).toMatchObject({
      phase: 'entry',
      pending: false,
      error: '세션이 만료되었습니다. 다시 시도해 주세요.',
    });
    expect(x.api.closeStream).toHaveBeenCalledTimes(1);
    expect(x.c.canRetry()).toBe(false);
    expect(localStorage.getItem('online.lastRoom')).not.toBeNull();

    x.api.post.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      body:
        kind === 'create'
          ? x.entry
          : { recoveryRequestId: 'recovery', status: 'PENDING', expiresAt: 'later' },
    }));
    x.api.get.mockReturnValue(new Promise(() => {}));
    expect(await attempt()).toBe(true);
    expect(x.api.open).toHaveBeenCalledTimes(2);
    expect(x.c.getView().error).toBeNull();
  },
);

// 세션 한도로 시작하지 못하면 입장 화면에서 원인을 안내하고 요청을 남기지 않는다
it('shows the session limit when the session cannot be opened', async () => {
  const x = setup();
  x.api.open.mockRejectedValueOnce(
    new ApiOpenError({ ok: false, unknown: true, code: 'SESSION_LIMIT', retryAfter: 60 }),
  );
  expect(await x.c.create('Alice')).toBe(false);
  expect(x.c.getView()).toMatchObject({ phase: 'entry', pending: false });
  expect(x.c.getView().error).toContain('접속자가 많습니다');
  expect(x.api.post).not.toHaveBeenCalled();
});

// 응답을 잃어도 최신 스냅샷만으로 요청을 확정하지 않는다
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
// 원장에 없는 요청은 최초 본문 그대로 재전송한다
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
// 버전 비교와 효과 조건 및 토너먼트 교체를 확인한다
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
// 종료 후 늦게 도착하는 응답이 방을 다시 열지 않는지 확인한다
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
// 초안 병합 중에도 일반 명령이 최신 초안을 추월하지 않게 한다
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
  // 실제 요청 필드를 서버 확정 응답으로 되돌린다
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
// 조작권 원장과 게임 명령 원장의 순번이 독립적인지 확인한다
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
// 끊긴 연결의 복구가 스냅샷 수신 전에 조작을 허용하지 않게 한다
it('keeps a reopened socket syncing until a snapshot arrives', async () => {
  const x = setup();
  await x.enter();
  x.h.onState('waiting');
  x.h.onState('open');
  expect(x.c.getView().connection).toBe('syncing');
  expect(await x.c.send([{ type: 'START', handScoped: false }])).toBe(false);
});
// 입장 결과 불명 요청을 새 식별자로 바꾸지 않는다
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
// 세션 표시가 없는 탭은 조회 화면으로만 복귀한다
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
// 복구 조회를 삼 초마다 실행하고 승인 응답의 세대를 사용한다
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
// 마지막 서버 메시지가 해당 화면 단계와 채널 종료를 결정한다
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
// 거절 응답은 최신 상태를 적용하고 명령 목록을 중단한다
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
// 원장 순번 오류가 새 조작 세대를 발급하고 다음 순번을 초기화하는지 확인한다
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
// 서버가 다른 세대의 응답을 주면 조작권을 잘못 얻지 않는다
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
// 화면을 떠난 이후의 조작권 응답이 권한을 복원하지 않게 한다
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
// 종료된 복구 조회가 방을 열거나 다음 조회를 예약하지 않게 한다
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
// 세션 유지 타이머와 복귀 이벤트가 화면 수명에만 존재하는지 확인한다
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
// 이전 스트림 준비가 끝나기 전에 새 스트림을 열지 않는다
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
// 종료된 화면의 응답을 기다리지 않고 새 방의 명령을 시작할 수 있어야 한다
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
// 이전 화면의 완료 처리가 새 화면에서 초안을 기다리는 명령 잠금을 해제하지 않아야 한다
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
// 결과 불명 초안은 화면을 잠그고 확정 원장 조회 이후에만 잠금을 해제한다
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
// 일반 명령이 기다리던 초안의 결과가 불명이어도 잠금을 유지한다
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
// 연결이나 조작권을 잃으면 아직 보내지 않은 초안은 폐기한다
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

// 나가기 응답과 권한 회수 소켓의 순서가 달라도 방과 탭 표시를 함께 정리한다
it.each([false, true])(
  'clears membership markers on LEAVE when revocation arrives first=%s',
  async (revokedFirst) => {
    const x = setup();
    await x.enter();
    x.api.post.mockImplementationOnce(async (_path, raw) => {
      const body = raw as { requestId: string; sequence: number };
      if (revokedFirst) x.h.onFinal('ACCESS_REVOKED');
      return {
        ok: true,
        status: 200,
        body: {
          requestId: body.requestId,
          sequence: body.sequence,
          outcome: 'APPLIED',
          code: 'OK',
          resultStateVersion: 2,
          latestState: null,
        },
      };
    });
    await x.c.send([{ type: 'LEAVE', handScoped: false }]);
    expect(x.c.getView().phase).toBe('entry');
    expect(x.c.getView().snapshot).toBeNull();
    expect(localStorage.getItem('online.lastRoom')).toBeNull();
    expect(sessionStorage.getItem('online.controlRoom')).toBeNull();
  },
);

// 서버 재시작으로 세션이나 방이 사라지면 재연결을 멈추고 소실 화면으로 보낸다
it.each(['NO_SESSION', 'ROOM_NOT_FOUND'])(
  'leaves the reconnect loop when the probe answers %s',
  async (code) => {
    const x = setup();
    await x.enter();
    x.api.get.mockResolvedValue({ ok: false, status: code === 'NO_SESSION' ? 401 : 404, code });
    x.h.onState('waiting');
    expect(x.api.get).not.toHaveBeenCalled();
    x.h.onState('connecting');
    x.h.onState('waiting');
    await vi.waitFor(() => expect(x.c.getView().phase).toBe('gone'));
    expect(x.api.get).toHaveBeenCalledTimes(1);
    expect(x.socket.close).toHaveBeenCalled();
    expect(localStorage.getItem('online.lastRoom')).toBeNull();
    expect(sessionStorage.getItem('online.controlRoom')).toBeNull();
  },
);

// 방이 살아 있거나 서버가 아직 응답하지 않으면 재연결을 계속한다
it.each([
  ['a live room', { ok: true, status: 200, body: {} }],
  ['an unreachable server', { ok: false, unknown: true }],
])('keeps reconnecting after %s', async (_name, result) => {
  const x = setup();
  await x.enter();
  x.api.get.mockResolvedValue(result);
  x.h.onState('waiting');
  x.h.onState('waiting');
  await vi.waitFor(() => expect(x.api.get).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  expect(x.c.getView().phase).toBe('room');
});

// 결과를 모르는 요청의 원장 조회에서 세션 상실을 확인해도 소실 화면으로 보낸다
it('treats a lost session during request lookup as a lost room', async () => {
  const x = setup();
  await x.enter();
  x.api.post.mockResolvedValueOnce({ ok: false, unknown: true });
  await x.c.send([{ type: 'CHECK', handScoped: false }]);
  x.api.get.mockResolvedValueOnce({ ok: false, status: 401, code: 'NO_SESSION' });
  await x.c.retry();
  expect(x.c.getView().phase).toBe('gone');
});

// HTTP 응답이 소켓보다 먼저 와도 요청자 화면의 칩 효과를 한 번 재생한다
it('plays the effects of its own action when HTTP confirms before the socket', async () => {
  const x = setup();
  await x.enter();
  const before = x.entry.state;
  const after = { ...before, stateVersion: before.stateVersion + 1 };
  const confirmed = vi.fn();
  x.c.onConfirmed(confirmed);
  x.api.post.mockImplementationOnce(async (_path, body) => ({
    ok: true,
    body: {
      ...(body as object),
      outcome: 'APPLIED',
      code: 'OK',
      resultStateVersion: after.stateVersion,
      latestState: after,
    },
  }));
  await x.c.send([{ type: 'CHECK', handScoped: false }]);
  expect(confirmed).not.toHaveBeenCalled();
  expect(x.c.getView().effectsFromVersion).toBe(before.stateVersion);
  const event = { id: 'e1', type: 'CHECK', details: {} };
  const message = {
    type: 'SNAPSHOT',
    previousVersion: before.stateVersion,
    events: [event],
    state: after,
  };
  x.h.onSnapshot(message as never);
  x.h.onSnapshot(message as never);
  expect(confirmed).toHaveBeenCalledTimes(1);
  expect(confirmed.mock.calls[0][0].events).toEqual([event]);
  expect(confirmed.mock.calls[0][0].previous).toEqual(before);
});

// 소켓이 먼저 왔다면 늦은 HTTP 응답이 효과를 다시 예약하지 않는다
it('does not repeat effects when the socket confirms before HTTP', async () => {
  const x = setup();
  await x.enter();
  const before = x.entry.state;
  const after = { ...before, stateVersion: before.stateVersion + 1 };
  const confirmed = vi.fn();
  x.c.onConfirmed(confirmed);
  const message = {
    type: 'SNAPSHOT',
    previousVersion: before.stateVersion,
    events: [{ id: 'e1', type: 'CHECK', details: {} }],
    state: after,
  };
  x.api.post.mockImplementationOnce(async (_path, body) => {
    x.h.onSnapshot(message as never);
    return {
      ok: true,
      body: {
        ...(body as object),
        outcome: 'APPLIED',
        code: 'OK',
        resultStateVersion: after.stateVersion,
        latestState: after,
      },
    };
  });
  await x.c.send([{ type: 'CHECK', handScoped: false }]);
  x.h.onSnapshot({ ...message, events: [{ id: 'e2', type: 'CHECK', details: {} }] } as never);
  expect(confirmed).toHaveBeenCalledTimes(1);
});

// 일시적인 네트워크 오류로는 복귀할 방 정보를 지우지 않는다
it('keeps the saved room when resume fails without an answer', async () => {
  const x = setup();
  localStorage.setItem('online.lastRoom', JSON.stringify({ roomId: 'room' }));
  sessionStorage.setItem('online.controlRoom', 'room');
  x.api.get.mockResolvedValueOnce({ ok: false, unknown: true });
  expect(await x.c.resume()).toBe(false);
  expect(x.c.getView().phase).toBe('entry');
  expect(localStorage.getItem('online.lastRoom')).not.toBeNull();
  expect(sessionStorage.getItem('online.controlRoom')).toBe('room');
});

// 세션을 준비하지 못한 복귀도 저장된 방 정보를 유지한다
it('keeps the saved room when the session cannot be opened', async () => {
  const x = setup();
  localStorage.setItem('online.lastRoom', JSON.stringify({ roomId: 'room' }));
  x.api.open.mockRejectedValueOnce(new Error('offline'));
  expect(await x.c.resume()).toBe(false);
  expect(x.c.getView().phase).toBe('entry');
  expect(localStorage.getItem('online.lastRoom')).not.toBeNull();
});

// 복구 대기 중 새로고침해도 같은 신청의 결과를 이어서 조회한다
it('resumes polling a recovery request after a reload', async () => {
  const first = setup();
  first.api.post.mockResolvedValueOnce({
    ok: true,
    body: { recoveryRequestId: 'recover', status: 'PENDING', expiresAt: 'later' },
  });
  first.api.get.mockResolvedValue({
    ok: true,
    body: { recoveryRequestId: 'recover', status: 'REJECTED' },
  });
  await first.c.requestRecovery('ABCDEF', 'Alice');
  await vi.waitFor(() => expect(first.c.getView().phase).toBe('entry'));
  expect(sessionStorage.getItem('online.recoveryRequest')).toBeNull();

  const second = setup();
  sessionStorage.setItem('online.recoveryRequest', 'recover');
  second.api.get.mockResolvedValueOnce({
    ok: true,
    body: { recoveryRequestId: 'recover', status: 'PENDING' },
  });
  expect(await second.c.resume()).toBe(true);
  expect(second.c.getView().phase).toBe('recovering');
  expect(second.c.getView().recovery?.status).toBe('PENDING');
  expect(second.api.get).toHaveBeenCalledWith('/api/recovery-requests/recover');
});

// 연결 한도 안내는 표시하고 스냅샷을 다시 받으면 지운다
it('shows the too-many-screens notice until a snapshot arrives', async () => {
  const x = setup();
  await x.enter();
  x.h.onTooManyScreens!();
  expect(x.c.getView().error).toContain('열린 화면이 너무 많습니다');
  x.h.onSnapshot({ type: 'SNAPSHOT', previousVersion: null, events: [], state: x.entry.state });
  expect(x.c.getView().error).toBeNull();
});
