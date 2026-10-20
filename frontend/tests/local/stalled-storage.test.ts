import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { LocalRepository } from '../../src/local/repository';
import { LocalController } from '../../src/local/controller';
import { defaultSettings } from '../../src/game/settings';

function holdEvent(kind: 'complete' | 'slot' | 'abort') {
  const releases: Array<() => void> = [];
  let entered!: () => void;
  const held = new Promise<void>((resolve) => (entered = resolve));
  const txAdd = IDBTransaction.prototype.addEventListener;
  const get = IDBObjectStore.prototype.get;
  function defer(target: EventTarget, listener: EventListenerOrEventListenerObject, event: Event) {
    releases.push(() => {
      if (typeof listener === 'function') listener.call(target, event);
      else listener.handleEvent(event);
    });
    entered();
  }
  if (kind === 'slot') {
    IDBObjectStore.prototype.get = function (...args) {
      const request = get.apply(this, args);
      if (this.name === 'slot') {
        const add = request.addEventListener;
        request.addEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) {
          if (type === 'success' && listener)
            add.call(this, type, (event) => defer(this, listener, event), options);
          else add.call(this, type, listener, options);
        };
      }
      return request;
    };
  } else {
    IDBTransaction.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === kind && listener)
        txAdd.call(this, type, (event) => defer(this, listener, event), options);
      else txAdd.call(this, type, listener, options);
    };
  }
  return {
    held,
    restore() {
      IDBTransaction.prototype.addEventListener = txAdd;
      IDBObjectStore.prototype.get = get;
    },
    release() {
      releases.splice(0).forEach((release) => release());
    },
  };
}

for (const operation of [
  'load',
  'takeControl',
  'initialize',
  'restart',
  'control',
  'readEvents',
] as const)
  it(`${operation}: 완료 알림 유실에도 8초 후 반환`, async () => {
    const repo = new LocalRepository(`deadline-${operation}`);
    const lease = await repo.takeControl('a');
    await repo.initialize(defaultSettings, lease);
    const gate = holdEvent('complete');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let outcome = 'pending';
    const work =
      operation === 'initialize'
        ? repo.initialize(defaultSettings, lease)
        : operation === 'takeControl'
          ? repo.takeControl('a')
          : operation === 'restart'
            ? repo.restart(defaultSettings, 'a')
            : operation === 'control'
              ? repo.control()
              : operation === 'readEvents'
                ? repo.readEvents('test', 0, 100)
                : repo.load();
    const settled = work.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );
    try {
      await gate.held;
      await vi.advanceTimersByTimeAsync(8001);
      expect(outcome).toBe('rejected');
    } finally {
      gate.restore();
      gate.release();
      await settled;
      vi.useRealTimers();
      repo.close();
    }
  });

for (const kind of ['slot', 'complete'] as const)
  it(`저장 ${kind === 'slot' ? '전' : '후'} 응답 유실: 요청 보존·재시도는 1회 반영·늦은 응답 무시`, async () => {
    const repo = new LocalRepository(`deadline-save-${kind}`);
    const controller = new LocalController(repo, 'a');
    await controller.takeControl();
    await repo.initialize({ ...defaultSettings, button: 0 }, controller.lease!);
    await controller.refresh();
    const gate = holdEvent(kind);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let result = 'pending';
    const work = controller.dispatch({ type: 'START_TOURNAMENT' }).then((r) => {
      result = r.status;
    });
    try {
      await gate.held;
      const requestId = controller.pending!.requestId;
      await vi.advanceTimersByTimeAsync(8001);
      expect(result).toBe('UNKNOWN');
      expect(controller.pending!.requestId).toBe(requestId);
      expect(controller.state!.status).toBe('setup');
      gate.restore();
      expect((await controller.retry()).status).toBe('APPLIED');
      expect(controller.pending).toBeNull();
      expect(controller.state!.hand!.number).toBe(1);
      expect(controller.state!.pot).toBe(15);
      gate.release();
      await work;
      expect((await repo.load())!.state.pot).toBe(15);
    } finally {
      gate.restore();
      gate.release();
      await work;
      vi.useRealTimers();
      repo.close();
    }
  });

it('abort 알림 유실도 오류 정리에서 다시 기다리지 않는다', async () => {
  const repo = new LocalRepository('deadline-abort');
  const lease = await repo.takeControl('a');
  await repo.initialize({ ...defaultSettings, button: 0 }, lease);
  const before = await repo.load();
  const gate = holdEvent('abort');
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'events') throw new DOMException('full', 'QuotaExceededError');
    return put.apply(this, args);
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let outcome = 'pending';
  const work = repo
    .dispatch({
      requestId: 'abort',
      sequence: 1,
      lease,
      expectedVersion: 0,
      tournamentId: before!.state.tournamentId,
      command: { type: 'START_TOURNAMENT' },
    })
    .then((r) => {
      outcome = r.status;
    });
  try {
    await gate.held;
    await vi.advanceTimersByTimeAsync(8001);
    expect(outcome).toBe('UNKNOWN');
    gate.restore();
    IDBObjectStore.prototype.put = put;
    expect(await repo.load()).toEqual(before);
  } finally {
    gate.restore();
    IDBObjectStore.prototype.put = put;
    gate.release();
    await work;
    vi.useRealTimers();
    repo.close();
  }
});

it('부분 쓰기 후 살아 있는 트랜잭션 시간 초과: 전체 rollback·재시도 1회', async () => {
  const repo = new LocalRepository('deadline-partial-write');
  const controller = new LocalController(repo, 'a');
  await controller.takeControl();
  await repo.initialize({ ...defaultSettings, button: 0 }, controller.lease!);
  await controller.refresh();
  const before = await repo.load(),
    owner = await repo.control();
  const put = IDBObjectStore.prototype.put;
  let entered!: () => void, release!: () => void;
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let pumping = true;
  function pump(store: IDBObjectStore) {
    if (!pumping) return;
    const request = store.get('current');
    request.onsuccess = () => pump(store);
    request.onerror = (event) => {
      pumping = false;
      event.preventDefault();
    };
  }
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    if (this.name === 'slot') {
      const keepAlive = () => pump(this);
      const add = request.addEventListener;
      request.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type === 'success')
          add.call(
            this,
            type,
            (event) => {
              release = () => {
                if (typeof listener === 'function') listener.call(this, event);
                else listener.handleEvent(event);
              };
              keepAlive();
              entered();
            },
            options,
          );
        else add.call(this, type, listener, options);
      };
    }
    return request;
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let outcome = 'pending';
  const work = controller.dispatch({ type: 'START_TOURNAMENT' }).then((r) => {
    outcome = r.status;
  });
  try {
    await held;
    await vi.advanceTimersByTimeAsync(8001);
    expect(outcome).toBe('UNKNOWN');
    IDBObjectStore.prototype.put = put;
    expect(await repo.load()).toEqual(before);
    expect(await repo.control()).toEqual(owner);
    expect(await repo.readEvents(before!.state.tournamentId, 0, 100)).toEqual([]);
    expect((await controller.retry()).status).toBe('APPLIED');
    release();
    await work;
    expect((await repo.load())!.state.pot).toBe(15);
    expect(
      (await repo.readEvents(before!.state.tournamentId, 0, 100)).filter(
        (event) => event.type === 'HAND_START',
      ),
    ).toHaveLength(1);
  } finally {
    pumping = false;
    IDBObjectStore.prototype.put = put;
    release?.();
    await work;
    vi.useRealTimers();
    repo.close();
  }
});

it('버린 화면의 저장소는 대기를 취소하고 늦은 작업·재연결도 거절한다', async () => {
  const repo = new LocalRepository('disposed-screen');
  const lease = await repo.takeControl('a');
  await repo.initialize(defaultSettings, lease);
  const gate = holdEvent('complete');
  const pending = repo.load();
  const rejected = expect(pending).rejects.toThrow();
  try {
    await gate.held;
    repo.dispose();
    await rejected;
    gate.restore();
    repo.reconnect();
    await expect(repo.restart(defaultSettings, 'old')).rejects.toThrow();
  } finally {
    gate.restore();
    gate.release();
    repo.close();
  }
});
