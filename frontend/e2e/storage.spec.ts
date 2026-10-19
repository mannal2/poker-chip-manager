import { test, expect } from '@playwright/test';
import type {} from './storage';
test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/storage.html');
  await page.waitForFunction(() => !!window.storageHarness);
});
test('실제 IndexedDB L01/L02/L04: 기록 실패 rollback, 동일 요청 재시도·교체 실패 원본 보존', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { repo, defaultSettings } = window.storageHarness,
      lease = await repo.takeControl('a');
    await repo.initialize({ ...defaultSettings, button: 0 }, lease);
    const before = await repo.load();
    const req = {
      requestId: 'start',
      sequence: 1,
      lease,
      expectedVersion: 0,
      tournamentId: before!.state.tournamentId,
      command: { type: 'START_TOURNAMENT' as const },
    };
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'events') throw new DOMException('용량 부족', 'QuotaExceededError');
      return original.apply(this, args);
    };
    const failed = await repo.dispatch(req);
    IDBObjectStore.prototype.put = original;
    const rollback = await repo.load();
    const a = await repo.dispatch(req),
      b = await repo.dispatch(req);
    const history = await repo.readEvents(before!.state.tournamentId, 0, 100);
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'slot') throw new DOMException('full', 'QuotaExceededError');
      return original.apply(this, args);
    };
    const replace = await repo.dispatch({
      ...req,
      requestId: 'replace',
      sequence: 2,
      expectedVersion: 1,
      command: { type: 'NEW_TOURNAMENT', settings: defaultSettings },
    });
    IDBObjectStore.prototype.put = original;
    return {
      failed,
      unchanged: JSON.stringify(before) === JSON.stringify(rollback),
      a,
      b,
      history: history.length,
      replace,
      after: await repo.load(),
      historyAfter: (await repo.readEvents(before!.state.tournamentId, 0, 100)).length,
    };
  });
  expect(r.failed.status).toBe('UNKNOWN');
  expect(r.unchanged).toBe(true);
  expect(r.a.status).toBe('APPLIED');
  expect(r.b.state?.version).toBe(1);
  expect(r.after?.state.pot).toBe(15);
  expect(r.replace.status).toBe('UNKNOWN');
  expect(r.historyAfter).toBe(r.history);
});
test('실제 두 탭 L03/X03: 저장→인수 / 인수→이전 쓰기', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('/e2e/storage.html');
  await other.waitForFunction(() => !!window.storageHarness);
  const a = await page.evaluate(async () => {
    const { repo, defaultSettings } = window.storageHarness;
    const lease = await repo.takeControl('a');
    await repo.initialize({ ...defaultSettings, button: 0 }, lease);
    const s = (await repo.load())!.state;
    return { lease, s };
  });
  const applied = await page.evaluate(
    async (a) =>
      window.storageHarness.repo.dispatch({
        requestId: 'first',
        sequence: 1,
        lease: a.lease,
        expectedVersion: a.s.version,
        tournamentId: a.s.tournamentId,
        command: { type: 'START_TOURNAMENT' },
      }),
    a,
  );
  expect(applied.status).toBe('APPLIED');
  const b = await other.evaluate(async () => {
    const repo = window.storageHarness.repo;
    const lease = await repo.takeControl('b');
    return { lease, s: (await repo.load())!.state };
  });
  expect(b.s.pot).toBe(15);
  const rejected = await page.evaluate(
    async (a) =>
      window.storageHarness.repo.dispatch({
        requestId: 'late',
        sequence: 2,
        lease: a.lease,
        expectedVersion: 1,
        tournamentId: a.s.tournamentId,
        command: { type: 'CALL' },
      }),
    a,
  );
  expect(rejected.reason).toBe('CONTROL_LOST');
  const leases = await Promise.all([
    page.evaluate(() => window.storageHarness.repo.takeControl('a2')),
    other.evaluate(() => window.storageHarness.repo.takeControl('b2')),
  ]);
  expect(leases[0].generation).not.toBe(leases[1].generation);
});
test('L05 공개 잠금 복원 / L06 알 수 없는 형식 원본 보존', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { repo, defaultSettings } = window.storageHarness;
    const lease = await repo.takeControl('a');
    await repo.initialize({ ...defaultSettings, names: ['A', 'B'], button: 0 }, lease);
    let state = (await repo.load())!.state;
    let sequence = 0;
    for (const type of ['START_TOURNAMENT', 'CALL', 'CHECK'] as const) {
      const r = await repo.dispatch({
        requestId: `x${sequence}`,
        sequence: ++sequence,
        lease,
        expectedVersion: state.version,
        tournamentId: state.tournamentId,
        command: { type },
      });
      state = r.state!;
    }
    repo.close();
    const restored = await repo.load();
    const undo = await repo.dispatch({
      requestId: 'undo',
      sequence: sequence + 1,
      lease,
      expectedVersion: state.version,
      tournamentId: state.tournamentId,
      command: { type: 'UNDO' },
    });
    repo.close();
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('browser-storage');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('slot', 'readwrite');
    tx.objectStore('slot').put({ ...restored, schemaVersion: 99 }, 'current');
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    let blocked = false;
    try {
      await repo.load();
    } catch {
      blocked = true;
    }
    return { phase: restored?.state.hand?.phase, undo, blocked };
  });
  expect(result.phase).toBe('betting');
  expect(result.undo.status).toBe('REJECTED');
  expect(result.blocked).toBe(true);
});

test('실제 IndexedDB X01 65건 후 만료 순번·기록 페이지 경계', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { repo, defaultSettings } = window.storageHarness,
      lease = await repo.takeControl('a');
    await repo.initialize({ ...defaultSettings, button: 0 }, lease);
    const s = (await repo.load())!.state,
      first = {
        requestId: 'r1',
        sequence: 1,
        lease,
        expectedVersion: 0,
        tournamentId: s.tournamentId,
        command: { type: 'SET_VIEW' as const, viewSeat: 0 },
      };
    await repo.dispatch(first);
    for (let n = 2; n <= 65; n++)
      await repo.dispatch({ ...first, requestId: 'r' + n, sequence: n, expectedVersion: n - 1 });
    const expired = await repo.dispatch(first),
      a = await repo.readEvents(s.tournamentId, 0, 50),
      b = await repo.readEvents(s.tournamentId, 50, 50);
    return {
      expired,
      version: (await repo.load())!.state.version,
      a: a.length,
      b: b.length,
      first: b[0].sequence,
    };
  });
  expect(result.expired.reason).toBe('RESULT_EXPIRED');
  expect(result.version).toBe(65);
  expect([result.a, result.b, result.first]).toEqual([50, 15, 51]);
});
test('L07 실제 versionchange는 구 연결을 닫고 쓰기를 차단한다', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { repo, defaultSettings } = window.storageHarness,
      lease = await repo.takeControl('a');
    await repo.initialize({ ...defaultSettings, button: 0 }, lease);
    const before = await repo.load();
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('browser-storage', 2);
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    let message = '';
    try {
      await repo.load();
    } catch (e) {
      message = String(e);
    }
    return { message, before };
  });
  expect(result.message).toContain('연결이 변경');
  expect(result.before?.state.status).toBe('setup');
});
