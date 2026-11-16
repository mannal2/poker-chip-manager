import { expect, it } from 'vitest';
import { renameError } from '../../src/game/settings';

// 이름 규칙 위반과 대소문자를 무시한 중복을 구분한다
it('names the rule for an invalid name and the duplicate for a taken one', () => {
  expect(renameError('!!', ['Bob'])).toBe('INVALID_NAME');
  expect(renameError('', ['Bob'])).toBe('INVALID_NAME');
  expect(renameError('bob', ['Bob'])).toBe('DUPLICATE_NAME');
  expect(renameError(' Bob ', ['bob'])).toBe('DUPLICATE_NAME');
  expect(renameError(' Ann ', ['Bob'])).toBeNull();
});
