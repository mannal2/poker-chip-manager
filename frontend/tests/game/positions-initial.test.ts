import { it, expect } from 'vitest';
import { initialBlindSeats } from '../../src/game/positions';
import { fixtureState } from './helpers';

const all = (n: number) => Array.from({ length: n }, () => true);

it('2인은 버튼이 SB, 상대가 BB다', () => {
  expect(initialBlindSeats(0, all(2))).toEqual({ sbSeat: 0, bbSeat: 1 });
  expect(initialBlindSeats(1, all(2))).toEqual({ sbSeat: 1, bbSeat: 0 });
});

it('3인 이상은 버튼 다음이 SB, 그다음이 BB이며 끝에서 처음으로 돈다', () => {
  expect(initialBlindSeats(0, all(3))).toEqual({ sbSeat: 1, bbSeat: 2 });
  expect(initialBlindSeats(8, all(10))).toEqual({ sbSeat: 9, bbSeat: 0 });
  expect(initialBlindSeats(9, all(10))).toEqual({ sbSeat: 0, bbSeat: 1 });
});

it('규칙의 첫 핸드 블라인드 좌석과 같다', () => {
  for (const n of [2, 3, 6, 10]) {
    const hand = fixtureState(n).hand!;
    expect(initialBlindSeats(0, all(n))).toEqual({ sbSeat: hand.sbSeat, bbSeat: hand.bbSeat });
  }
});
