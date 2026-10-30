import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  readStorageErrors,
  recordStorageError,
} from '../../src/features/local-game/storage/errorLog';
import { LocalRepository } from '../../src/features/local-game/storage/repository';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}
beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

it('저장 오류의 종류·단계·시각을 최근 10건까지 남긴다', () => {
  for (let i = 0; i < 12; i++)
    recordStorageError(`단계${i}`, new DOMException(`실패${i}`, 'QuotaExceededError'));
  const log = readStorageErrors();
  expect(log).toHaveLength(10);
  expect(log[0]).toMatchObject({ phase: '단계11', name: 'QuotaExceededError', message: '실패11' });
  expect(log.at(-1)?.phase).toBe('단계2');
  expect(Date.parse(log[0].at)).not.toBeNaN();
});

it('기록 저장소가 막혀도 오류를 던지지 않는다', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new DOMException('blocked', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('blocked', 'SecurityError');
    },
  });
  expect(() => recordStorageError('게임 저장', new Error('x'))).not.toThrow();
  expect(readStorageErrors()).toEqual([]);
});

it('저장소 작업이 실패하면 그 단계와 오류 종류를 기록한다', async () => {
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args) {
    if (args[1] === 'readwrite') throw new DOMException('disk full', 'QuotaExceededError');
    return original.apply(this, args);
  } as typeof original;
  const r = new LocalRepository('error-log-test');
  try {
    await expect(r.takeControl('a')).rejects.toThrow('disk full');
  } finally {
    IDBDatabase.prototype.transaction = original;
    r.close();
  }
  expect(readStorageErrors()[0]).toMatchObject({
    phase: '조작권 저장',
    name: 'QuotaExceededError',
    message: 'disk full',
  });
});
