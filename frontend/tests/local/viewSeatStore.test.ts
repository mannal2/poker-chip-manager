import { afterEach, it, expect, vi } from 'vitest';
import {
  legacyViewSeat,
  readViewSeat,
  viewSeatKey,
  writeViewSeat,
} from '../../src/features/local-game/model/viewSeatStore';
import { fixtureState } from '../game/helpers';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}
afterEach(() => vi.unstubAllGlobals());

it('토너먼트별로 기억하고 다른 토너먼트는 기본값에서 시작한다', () => {
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  expect(readViewSeat('t1')).toBe(0);
  writeViewSeat('t1', 2);
  expect(readViewSeat('t1')).toBe(2);
  expect(readViewSeat('t2')).toBe(0);
  expect(readViewSeat(undefined)).toBe(0);
  expect(JSON.parse(storage.items.get(viewSeatKey)!)).toEqual({ tournamentId: 't1', seat: 2 });
});

it('저장 값이 없으면 예전 버전이 설정에 저장한 회전을 이어받는다', () => {
  vi.stubGlobal('localStorage', memoryStorage());
  const old = fixtureState(4);
  (old.settings as { viewSeat?: number }).viewSeat = 3;
  expect(legacyViewSeat(old)).toBe(3);
  expect(readViewSeat(old.tournamentId, legacyViewSeat(old))).toBe(3);
  writeViewSeat(old.tournamentId, 1);
  expect(readViewSeat(old.tournamentId, legacyViewSeat(old))).toBe(1);
  expect(legacyViewSeat(null)).toBe(0);
  (old.settings as { viewSeat?: unknown }).viewSeat = 'x';
  expect(legacyViewSeat(old)).toBe(0);
});

it('저장소가 막히거나 값이 깨져도 예외 없이 기본값을 쓴다', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw Error('blocked');
    },
    setItem: () => {
      throw Error('blocked');
    },
  });
  expect(() => writeViewSeat('t1', 2)).not.toThrow();
  expect(readViewSeat('t1', 1)).toBe(1);
  const broken = memoryStorage();
  broken.items.set(viewSeatKey, '{not json');
  vi.stubGlobal('localStorage', broken);
  expect(readViewSeat('t1')).toBe(0);
  broken.items.set(viewSeatKey, JSON.stringify({ tournamentId: 't1', seat: -1 }));
  expect(readViewSeat('t1')).toBe(0);
});
