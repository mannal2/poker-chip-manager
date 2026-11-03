import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomSocket, reconnectDelay } from '../../src/features/online-game/realtime/roomSocket';
import snapshot from '../../../shared/api-contract/ws-snapshot.json';
import create from '../../../shared/api-contract/create-room.json';
import { OnlineController } from '../../src/features/online-game/session/onlineController';

// 브라우저 소켓의 외부 이벤트를 수동으로 전달한다
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: unknown[] = [];
  // 생성한 연결을 기록한다
  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }
  // 전송한 프로토콜 메시지를 기록한다
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  // 연결 종료 이벤트를 전달한다
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  // 연결 완료 이벤트를 전달한다
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  // 서버 메시지를 전달한다
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
let visibility: EventTarget & { visibilityState: string };
let room: RoomSocket;
// 실제 컨트롤러와 소켓을 함께 사용하여 PING 하나에 RESYNC 한 번만 전송하는지 확인한다
it('sends exactly one RESYNC for a newer PING through the real controller', async () => {
  const storage = { setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  const api = {
    open: vi.fn(),
    streamId: 'stream',
    closeStream: vi.fn().mockResolvedValue(undefined),
    post: vi.fn().mockResolvedValue({ ok: true, body: create.response }),
  };
  const controller = new OnlineController(
    api as never,
    (handlers) => (room = new RoomSocket('ws://test', handlers)),
  );
  try {
    await controller.create('Alice');
    const ws = FakeSocket.instances[0];
    ws.open();
    ws.message({ ...snapshot, state: create.response.state });
    ws.message({
      type: 'PING',
      stateVersion: create.response.state.stateVersion + 1,
      nonce: 'next',
    });
    expect(controller.getView().connection).toBe('syncing');
    expect(ws.sent.slice(1)).toEqual([{ type: 'PONG', nonce: 'next' }, { type: 'RESYNC' }]);
  } finally {
    controller.dispose();
  }
});
// 연결마다 가짜 시간과 브라우저 경계를 초기화한다
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  FakeSocket.instances = [];
  visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', visibility);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('WebSocket', FakeSocket);
});
// 연결이 소유한 자원과 가짜 브라우저 환경을 정리한다
afterEach(() => {
  room?.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// 기본 핸들러와 함께 연결을 준비한다
function setup() {
  const handlers = { onSnapshot: vi.fn(), onFinal: vi.fn(), onPing: vi.fn(), onState: vi.fn() };
  room = new RoomSocket('ws://test', handlers);
  room.subscribe(snapshot.state.roomId, 9);
  return handlers;
}

// 브라우저의 오프라인 알림으로 즉시 잠그고 연결 복귀 시 소켓을 교체한다
it('closes immediately on offline and reconnects immediately on online', () => {
  const handlers = setup();
  FakeSocket.instances[0].open();
  window.dispatchEvent(new Event('offline'));
  expect(handlers.onState).toHaveBeenLastCalledWith('waiting');
  expect(FakeSocket.instances[0].readyState).toBe(3);
  vi.advanceTimersByTime(15000);
  visibility.dispatchEvent(new Event('visibilitychange'));
  expect(FakeSocket.instances).toHaveLength(1);
  window.dispatchEvent(new Event('online'));
  expect(FakeSocket.instances).toHaveLength(2);
  FakeSocket.instances[1].open();
  expect(FakeSocket.instances[1].sent[0]).toMatchObject({ type: 'SUBSCRIBE' });
  room.close();
  window.dispatchEvent(new Event('online'));
  expect(FakeSocket.instances).toHaveLength(2);
});

// 외부 상태 콜백에서 종료하면 이후 소켓과 타이머를 만들지 않는다
it.each(['connecting', 'open', 'waiting'])(
  'stops all work when closed from %s callback',
  (state) => {
    const handlers = setup();
    handlers.onState.mockImplementation((next) => {
      if (next === state) room.close();
    });
    const first = FakeSocket.instances[0];
    if (state === 'connecting') {
      visibility.dispatchEvent(new Event('visibilitychange'));
      expect(FakeSocket.instances).toHaveLength(1);
    } else {
      first.open();
      if (state === 'waiting') first.close();
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeSocket.instances.every((socket) => socket.readyState === 3)).toBe(true);
    vi.advanceTimersByTime(120000);
    visibility.dispatchEvent(new Event('visibilitychange'));
    expect(FakeSocket.instances).toHaveLength(1);
  },
);

// 구독 및 PING 응답과 전달한 스냅샷 이후의 버전 추적을 확인한다
it('subscribes, validates snapshots, echoes nonce and reports advertised versions', () => {
  const handlers = setup();
  const ws = FakeSocket.instances[0];
  ws.open();
  expect(ws.sent[0]).toEqual({
    type: 'SUBSCRIBE',
    roomId: snapshot.state.roomId,
    protocolVersion: 1,
    lastSeenVersion: 9,
  });
  ws.message({ type: 'SNAPSHOT', state: {} });
  expect(handlers.onSnapshot).not.toHaveBeenCalled();
  ws.message(snapshot);
  expect(handlers.onSnapshot).toHaveBeenCalledWith(snapshot);
  ws.message({ type: 'PING', nonce: 'n', stateVersion: snapshot.state.stateVersion });
  expect(ws.sent.at(-1)).toEqual({ type: 'PONG', nonce: 'n' });
  ws.message({ type: 'PING', nonce: 'next', stateVersion: snapshot.state.stateVersion + 1 });
  expect(ws.sent.at(-1)).toEqual({ type: 'PONG', nonce: 'next' });
  expect(handlers.onPing).toHaveBeenLastCalledWith(snapshot.state.stateVersion + 1);
});

// 마지막 메시지가 없는 정상 종료도 재연결하고 성공하면 지연을 초기화한다
it('reconnects and resubscribes after every nonfinal close and resets backoff on open', () => {
  setup();
  const first = FakeSocket.instances[0];
  first.open();
  first.close();
  expect(room.state).toBe('waiting');
  vi.advanceTimersByTime(999);
  expect(FakeSocket.instances).toHaveLength(1);
  vi.advanceTimersByTime(1);
  const second = FakeSocket.instances[1];
  second.close();
  vi.advanceTimersByTime(1999);
  expect(FakeSocket.instances).toHaveLength(2);
  vi.advanceTimersByTime(1);
  const third = FakeSocket.instances[2];
  third.open();
  expect(third.sent[0]).toMatchObject({ type: 'SUBSCRIBE', lastSeenVersion: 9 });
  third.close();
  vi.advanceTimersByTime(1000);
  expect(FakeSocket.instances).toHaveLength(4);
});

// 모든 마지막 메시지는 닫힘 코드와 무관하게 재연결을 중단한다
it.each(['ACCESS_REVOKED', 'ROOM_GONE', 'PROTOCOL_INCOMPATIBLE'])('stops after %s', (type) => {
  const handlers = setup();
  const ws = FakeSocket.instances[0];
  ws.open();
  ws.message({ type });
  ws.close(1008);
  vi.advanceTimersByTime(120000);
  expect(handlers.onFinal).toHaveBeenCalledWith(type);
  expect(FakeSocket.instances).toHaveLength(1);
});

// PING 감시와 화면 복귀는 재연결하며 오래된 콜백과 종료 후 이벤트를 무시한다
it('watches ping silence, reconnects immediately on return and disposes stale callbacks', () => {
  const handlers = setup();
  const first = FakeSocket.instances[0];
  first.open();
  const stale = first.onmessage!;
  const staleOpen = first.onopen!;
  first.message(snapshot);
  vi.advanceTimersByTime(45000);
  expect(room.state).toBe('waiting');
  visibility.dispatchEvent(new Event('visibilitychange'));
  expect(FakeSocket.instances).toHaveLength(2);
  const second = FakeSocket.instances[1];
  second.open();
  stale({ data: JSON.stringify({ type: 'ROOM_GONE' }) });
  first.close();
  staleOpen();
  expect(room.state).toBe('open');
  expect(handlers.onFinal).not.toHaveBeenCalled();
  room.close();
  visibility.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(120000);
  expect(FakeSocket.instances).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

// 유효한 PING은 감시 시간을 갱신하고 끊긴 동안 보낸 RESYNC는 재생하지 않는다
it('renews the watchdog for each ping and never queues disconnected messages', () => {
  setup();
  const first = FakeSocket.instances[0];
  first.open();
  first.message({ ...snapshot, state: { ...snapshot.state, stateVersion: 9 } });
  vi.advanceTimersByTime(44000);
  first.message({ type: 'PING', nonce: 'alive', stateVersion: 9 });
  vi.advanceTimersByTime(44000);
  expect(room.state).toBe('open');
  vi.advanceTimersByTime(1000);
  expect(room.state).toBe('waiting');
  room.resync();
  vi.advanceTimersByTime(1000);
  const second = FakeSocket.instances[1];
  second.open();
  expect(second.sent).toEqual([
    { type: 'SUBSCRIBE', roomId: snapshot.state.roomId, protocolVersion: 1, lastSeenVersion: 9 },
  ]);
});

// 상태 발행이 계속되어도 PING이 끊긴 연결은 사십오 초 뒤에 교체한다
it('detects missing PING even while snapshots keep arriving', () => {
  setup();
  const first = FakeSocket.instances[0];
  first.open();
  first.message(snapshot);
  first.message({ type: 'PING', nonce: 'last', stateVersion: snapshot.state.stateVersion });
  vi.advanceTimersByTime(44000);
  first.message(snapshot);
  vi.advanceTimersByTime(1000);
  expect(room.state).toBe('waiting');
});

// 재연결 간격의 지터 범위와 최대 기준 시간을 확인한다
it('bounds jitter across all backoff steps', () => {
  expect([0, 1, 2, 3, 4, 8].map((n) => reconnectDelay(n, () => 0))).toEqual([
    800, 1600, 3200, 6400, 12000, 12000,
  ]);
  expect(reconnectDelay(4, () => 1)).toBeCloseTo(18000);
});

// 화면 복귀 시 겉으로 열린 소켓도 즉시 교체하여 정지했던 연결을 복구한다
it.each([false, true])('replaces a connecting or open connection on return (open=%s)', (opened) => {
  setup();
  const first = FakeSocket.instances[0];
  if (opened) first.open();
  visibility.visibilityState = 'hidden';
  visibility.dispatchEvent(new Event('visibilitychange'));
  expect(FakeSocket.instances).toHaveLength(1);
  visibility.visibilityState = 'visible';
  visibility.dispatchEvent(new Event('visibilitychange'));
  expect(FakeSocket.instances).toHaveLength(2);
  expect(first.readyState).toBe(opened ? 1 : 3);
  const replacement = FakeSocket.instances[1];
  replacement.open();
  expect(first.readyState).toBe(opened ? 1 : 3);
  replacement.message(snapshot);
  expect(first.readyState).toBe(3);
});

// 추가 구독 한도에 걸리면 기존 소켓의 전체 상태를 요청하고 무응답 시간도 제한한다
it('probes retained presence after replacement refusal and bounds a stalled handshake', () => {
  const h = setup();
  const first = FakeSocket.instances[0];
  first.open();
  visibility.dispatchEvent(new Event('visibilitychange'));
  FakeSocket.instances[1].close(1013);
  expect(first.sent.at(-1)).toEqual({ type: 'RESYNC' });
  expect(first.readyState).toBe(1);
  first.message(snapshot);
  expect(h.onSnapshot).toHaveBeenCalledWith(snapshot);
  visibility.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(10000);
  expect(FakeSocket.instances[2].readyState).toBe(3);
  expect(first.sent.at(-1)).toEqual({ type: 'RESYNC' });
  vi.advanceTimersByTime(10000);
  expect(first.readyState).toBe(3);
  expect(room.state).toBe('waiting');
});

// 구독 교체 중 복귀가 반복되어도 연결을 늘리지 않고 종료 경로마다 양쪽 소켓을 정리한다
it.each(['offline', 'close', 'retained final', 'replacement final'])(
  'releases both sockets on %s during replacement',
  (reason) => {
    const h = setup();
    const first = FakeSocket.instances[0];
    first.open();
    first.message(snapshot);
    room.reconnect();
    const second = FakeSocket.instances[1];
    second.open();
    room.reconnect();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(first.readyState).toBe(1);
    if (reason === 'offline') window.dispatchEvent(new Event('offline'));
    else if (reason === 'close') room.close();
    else (reason === 'retained final' ? first : second).message({ type: 'ACCESS_REVOKED' });
    expect([first.readyState, second.readyState]).toEqual([3, 3]);
    first.message(snapshot);
    second.message(snapshot);
    expect(h.onSnapshot).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(FakeSocket.instances).toHaveLength(2);
  },
);

// 같은 토너먼트의 지연 상태는 기준을 낮추지 않고 새 토너먼트는 낮은 버전을 허용한다
it('tracks delivered versions within each tournament without retaining an old tournament maximum', () => {
  setup();
  const ws = FakeSocket.instances[0];
  ws.open();
  ws.message(snapshot);
  ws.message({
    ...snapshot,
    state: { ...snapshot.state, stateVersion: snapshot.state.stateVersion - 1 },
  });
  room.reconnect();
  const second = FakeSocket.instances[1];
  second.open();
  expect(second.sent[0]).toMatchObject({
    type: 'SUBSCRIBE',
    lastSeenVersion: snapshot.state.stateVersion,
  });
  second.message({
    ...snapshot,
    state: { ...snapshot.state, tournamentId: 'new', stateVersion: 1 },
  });
  room.reconnect();
  FakeSocket.instances[2].open();
  expect(FakeSocket.instances[2].sent[0]).toMatchObject({ type: 'SUBSCRIBE', lastSeenVersion: 1 });
});

// 서버의 연결 한도 거절을 일반 끊김과 구분해 알리고 재연결은 계속한다
it('reports a full server close and keeps retrying', () => {
  const onTooManyScreens = vi.fn();
  const handlers = {
    onSnapshot: vi.fn(),
    onFinal: vi.fn(),
    onPing: vi.fn(),
    onState: vi.fn(),
    onTooManyScreens,
  };
  const socket = new RoomSocket('ws://test', handlers);
  socket.subscribe('room', 1);
  const first = FakeSocket.instances.at(-1)!;
  first.open();
  first.close(1013);
  expect(onTooManyScreens).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1500);
  expect(FakeSocket.instances.at(-1)).not.toBe(first);
  socket.close();
});
