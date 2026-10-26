import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { errorMessages, messageFor } from '../../src/features/gameplay/model/errorMessages';
import { validateSettings, defaultSettings } from '../../src/game/settings';
import { previewSettlement } from '../../src/game/settlement';
import { getLegalActions, transition } from '../../src/game/transition';
import { fixtureState, ctx } from '../game/helpers';

const source = (path: string) =>
  readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

it('규칙·저장소가 반환하는 모든 거절 코드에 문구가 있다', () => {
  const codes = new Set<string>();
  for (const m of source('game/transition.ts').matchAll(/requireRule\([^;]*?'([A-Z_]+)'\)/gs))
    codes.add(m[1]);
  for (const m of source('features/local-game/storage/repository.ts').matchAll(
    /rejected\('([A-Z_]+)'\)/g,
  ))
    codes.add(m[1]);
  for (const m of source('features/local-game/storage/controller.ts').matchAll(
    /reason: '([A-Z_]+)'/g,
  ))
    codes.add(m[1]);
  for (const file of ['game/settings.ts', 'game/settlement.ts', 'game/betting.ts'])
    for (const m of source(file).matchAll(/(?:code: |fail\()'([A-Z_]+)'/g)) codes.add(m[1]);
  expect(codes.size).toBeGreaterThan(20);
  for (const code of codes) expect(errorMessages, code).toHaveProperty(code);
});

it('사용자 문구에는 코드가 그대로 보이지 않는다', () => {
  for (const [code, text] of Object.entries(errorMessages)) {
    expect(text, code).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    expect(messageFor(code)).toBe(text);
  }
  expect(messageFor('STALE_STATE')).toBe(errorMessages.STALE_STATE);
});

it('모르는 코드는 코드를 덧붙이고 일반 문장은 그대로 보여준다', () => {
  expect(messageFor('NEW_SERVER_CODE')).toBe('처리할 수 없습니다. (NEW_SERVER_CODE)');
  expect(messageFor('저장소 응답 시간 초과')).toBe('저장소 응답 시간 초과');
  expect(messageFor(undefined)).toBe('처리할 수 없습니다.');
});

it('규칙은 문장 대신 코드를 반환하고 화면 문구는 기존과 같다', () => {
  const settings = validateSettings({ ...defaultSettings, names: ['A', 'a'] });
  expect(settings).toEqual({ ok: false, code: 'INVALID_NAMES' });
  expect(messageFor(settings.ok ? '' : settings.code)).toBe(
    '이름은 1~10자의 한글·영문·숫자, 중복 없이 2~10명으로 설정하세요.',
  );
  const s = fixtureState();
  expect(previewSettlement(s, {}, []).error).toBe('NO_POT');
  expect(getLegalActions({ ...s, status: 'ended' }).reasonCode).toBe('NOT_ACTOR');
  expect(getLegalActions(s).reasonCode).toBeNull();
  const r = transition(s, { type: 'RAISE', additional: 15 }, ctx);
  expect(r).toEqual({ ok: false, errorCode: 'MIN_RAISE' });
});
