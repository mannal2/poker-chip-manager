import type { SettingsErrorCode } from './errors';
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
export type SettingsValidation =
  { ok: true; settings: GameSettings } | { ok: false; code: SettingsErrorCode };
export function validChips(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && n <= 1000000 && n % 5 === 0;
}
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
