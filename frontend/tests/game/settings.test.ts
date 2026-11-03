import { describe, it, expect } from 'vitest';
import { normalizeName, validateSettings } from '../../src/game/settings';
const valid = { names: [' 지우 ', '민준'], initial: 1000, sb: 5, bb: 10, button: 0 };
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

it('예전 버전의 화면 회전 값은 설정 검증에서 무시하고 결과에서 뺀다', () => {
  const v = validateSettings({ ...valid, viewSeat: 1 } as typeof valid);
  expect(v.ok && Object.keys(v.settings).sort()).toEqual([
    'bb',
    'button',
    'initial',
    'names',
    'sb',
  ]);
});
// 이름 하나를 서버와 같은 규칙으로 정규화하거나 거절한다
describe('이름 하나', () => {
  it('앞뒤 공백 제거와 NFC 정규화', () => {
    expect(normalizeName(' 지우 ')).toBe('지우');
    expect(normalizeName('가')).toBe('가');
    expect(normalizeName('Ab 12')).toBe('Ab 12');
    expect(normalizeName('가나다라마바사아자차')).toBe('가나다라마바사아자차');
    expect(normalizeName('ㄱ')).toBe('ㄱ');
    expect(normalizeName('ㅏ')).toBe('ㅏ');
    expect(normalizeName('ㅎㅎ ㄲㅘ')).toBe('ㅎㅎ ㄲㅘ');
  });
  for (const name of ['', '   ', 'a!', '가나다라마바사아자차카', 'é', 'ㅤ', 'ㆍ'])
    it(`거절 ${JSON.stringify(name)}`, () => expect(normalizeName(name)).toBeNull());
});
