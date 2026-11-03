import type { SettingsErrorCode } from './errors';
// 테이블 설정(이름, 시작 칩, 블라인드, 버튼 좌석)
export interface GameSettings {
  names: string[];
  initial: number;
  sb: number;
  bb: number;
  button: number;
}
export const defaultSettings: GameSettings = {
  names: ['P1', 'P2'],
  initial: 1000,
  sb: 5,
  bb: 10,
  button: -1,
};
// 설정 검증 결과(정규화된 설정 또는 실패 사유)
export type SettingsValidation =
  { ok: true; settings: GameSettings } | { ok: false; code: SettingsErrorCode };
// 칩 금액이 유효한 범위와 단위인지 확인한다
export function validChips(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && n <= 1000000 && n % 5 === 0;
}
// 이름을 정규화하고 이름/칩/좌석 규칙을 검사해 검증 결과를 돌려준다
export function validateSettings(input: GameSettings): SettingsValidation {
  const names = input.names.map((n) => n.trim().normalize('NFC'));
  if (
    names.length < 2 ||
    names.length > 10 ||
    names.some((n) => !/^[가-힣a-zA-Z0-9 ]{1,10}$/.test(n)) ||
    new Set(names.map((n) => n.toLowerCase())).size !== names.length
  )
    return { ok: false, code: 'INVALID_NAMES' };
  if (
    ![input.initial, input.sb, input.bb].every(validChips) ||
    input.sb >= input.bb ||
    input.bb > input.initial
  )
    return { ok: false, code: 'INVALID_CHIP_SETTINGS' };
  if (!Number.isInteger(input.button) || input.button < -1 || input.button >= names.length)
    return { ok: false, code: 'INVALID_SEATS' };
  // Only known fields: settings saved by older versions may still carry a screen rotation.
  const { initial, sb, bb, button } = input;
  return { ok: true, settings: { names, initial, sb, bb, button } };
}
