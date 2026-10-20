import { describe, it, expect } from 'vitest';
import { validateSettings } from '../../src/game/settings';
const valid = { names: [' 지우 ', '민준'], initial: 1000, sb: 5, bb: 10, button: 0, viewSeat: 0 };
describe('설정 경계', () => {
  it('2/10명, trim, 기본 설정', () => {
    expect(validateSettings(valid).ok).toBe(true);
    expect(
      validateSettings({ ...valid, names: Array.from({ length: 10 }, (_, i) => `사람${i}`) }).ok,
    ).toBe(true);
  });
  for (const names of [
    ['한명'],
    Array.from({ length: 11 }, (_, i) => `P${i + 1}`),
    ['a', 'A'],
    [' ', '민준'],
    ['가나다라마바사아자차카', '민준'],
    ['a!', 'b'],
  ])
    it(`이름 거절 ${names}`, () => expect(validateSettings({ ...valid, names }).ok).toBe(false));
  for (const values of [
    { initial: 5 },
    { sb: 10 },
    { bb: 12 },
    { initial: 1000005 },
    { sb: 0 },
    { bb: 0 },
    { bb: 1.5 },
  ])
    it(`금액 거절 ${JSON.stringify(values)}`, () =>
      expect(validateSettings({ ...valid, ...values }).ok).toBe(false));
});
