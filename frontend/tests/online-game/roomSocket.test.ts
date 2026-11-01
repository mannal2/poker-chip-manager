import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomSocket, reconnectDelay } from '../../src/features/online-game/realtime/roomSocket';
import snapshot from '../../../shared/api-contract/ws-snapshot.json';

// 브라우저 소켓의 외부 이벤트를 수동으로 전달한다.
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: unknown[] = [];
  // 생성한 연결을 기록한다.
  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }
  // 전송한 프로토콜 메시지를 기록한다.
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  // 연결 종료 이벤트를 전달한다.
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  // 연결 완료 이벤트를 전달한다.
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  // 서버 메시지를 전달한다.
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
let visibility: EventTarget & { visibilityState: string };
let room: RoomSocket;
// 연결마다 가짜 시간과 브라우저 경계를 초기화한다.
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  FakeSocket.instances = [];
  visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', visibility);
  vi.stubGlobal('WebSocket', FakeSocket);
});
// 연결이 소유한 자원과 가짜 브라우저 환경을 정리한다.
afterEach(() => {
  room?.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// 기본 핸들러와 함께 연결을 준비한다.
function setup() {
  const handlers = { onSnapshot: vi.fn(), onFinal: vi.fn(), onPing: vi.fn(), onState: vi.fn() };
  room = new RoomSocket('ws://test', handlers);
  room.subscribe(snapshot.state.roomId, 9);
  return handlers;
}

// 구독 및 PING 응답과 전달한 스냅샷 이후의 버전 추적을 확인한다.
it('subscribes, validates snapshots, echoes nonce and resyncs newer versions', () => {
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
  expect(ws.sent.slice(-2)).toEqual([{ type: 'PONG', nonce: 'next' }, { type: 'RESYNC' }]);
  expect(handlers.onPing).toHaveBeenLastCalledWith(snapshot.state.stateVersion + 1);
});

// 마지막 메시지가 없는 정상 종료도 재연결하고 성공하면 지연을 초기화한다.
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

// 모든 마지막 메시지는 닫힘 코드와 무관하게 재연결을 중단한다.
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

// PING 감시와 화면 복귀는 재연결하며 오래된 콜백과 종료 후 이벤트를 무시한다.
it('watches ping silence, reconnects immediately on return and disposes stale callbacks', () => {
  const handlers = setup();
  const first = FakeSocket.instances[0];
  first.open();
  const stale = first.onmessage!;
  const staleOpen = first.onopen!;
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

// 유효한 PING은 감시 시간을 갱신하고 끊긴 동안 보낸 RESYNC는 재생하지 않는다.
it('renews the watchdog for each ping and never queues disconnected messages', () => {
  setup();
  const first = FakeSocket.instances[0];
  first.open();
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

// 재연결 간격의 지터 범위와 최대 기준 시간을 확인한다.
it('bounds jitter across all backoff steps', () => {
  expect([0, 1, 2, 3, 4, 8].map((n) => reconnectDelay(n, () => 0))).toEqual([
    800, 1600, 3200, 6400, 12000, 12000,
  ]);
  expect(reconnectDelay(4, () => 1)).toBeCloseTo(18000);
});

// 화면 복귀 시 겉으로 열린 소켓도 즉시 교체하여 정지했던 연결을 복구한다.
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
  expect(first.readyState).toBe(3);
});

// 같은 토너먼트의 지연 상태는 기준을 낮추지 않고 새 토너먼트는 낮은 버전을 허용한다.
it('tracks delivered versions within each tournament without retaining an old tournament maximum', () => {
  setup();
  const ws = FakeSocket.instances[0];
  ws.open();
  ws.message(snapshot);
  ws.message({
    ...snapshot,
    state: { ...snapshot.state, stateVersion: snapshot.state.stateVersion - 1 },
  });
  ws.message({ type: 'PING', nonce: 'same', stateVersion: snapshot.state.stateVersion });
  expect(ws.sent.at(-1)).toEqual({ type: 'PONG', nonce: 'same' });
  ws.message({ ...snapshot, state: { ...snapshot.state, tournamentId: 'new', stateVersion: 1 } });
  ws.message({ type: 'PING', nonce: 'new', stateVersion: 2 });
  expect(ws.sent.at(-1)).toEqual({ type: 'RESYNC' });
});
