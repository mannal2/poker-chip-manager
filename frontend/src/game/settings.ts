export interface GameSettings {
  names: string[];
  initial: number;
  sb: number;
  bb: number;
  button: number;
  viewSeat: number;
}
export const defaultSettings: GameSettings = {
  names: ['P1', 'P2'],
  initial: 1000,
  sb: 5,
  bb: 10,
  button: -1,
  viewSeat: 0,
};
export type SettingsValidation =
  { ok: true; settings: GameSettings } | { ok: false; error: string };
export function validChips(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && n <= 1000000 && n % 5 === 0;
}
export function validateSettings(input: GameSettings): SettingsValidation {
  const names = input.names.map((n) => n.trim().normalize('NFC'));
  if (
    names.length < 2 ||
    names.length > 9 ||
    names.some((n) => !/^[가-힣a-zA-Z0-9 ]{1,10}$/.test(n)) ||
    new Set(names.map((n) => n.toLowerCase())).size !== names.length
  )
    return { ok: false, error: '이름은 1~10자의 한글·영문·숫자, 중복 없이 2~9명으로 설정하세요.' };
  if (
    ![input.initial, input.sb, input.bb].every(validChips) ||
    input.sb >= input.bb ||
    input.bb > input.initial
  )
    return { ok: false, error: '5 단위, 0 < SB < BB ≤ 시작 칩 (최대 1,000,000)으로 설정하세요.' };
  if (
    !Number.isInteger(input.button) ||
    input.button < -1 ||
    input.button >= names.length ||
    !Number.isInteger(input.viewSeat) ||
    input.viewSeat < 0 ||
    input.viewSeat >= names.length
  )
    return { ok: false, error: '좌석을 확인하세요.' };
  return { ok: true, settings: { ...input, names } };
}
