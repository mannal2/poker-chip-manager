import { it, expect } from 'vitest';
import { defaultSettings, validateSettings } from '../../src/game/settings';
import { createTournament, transition } from '../../src/game/transition';
import type { GameCommand, GameState } from '../../src/game/types';
const context = { id: 'setup-test', at: '2026-10-18T00:00:00Z' };
function apply(s: GameState, cmd: GameCommand) {
  const r = transition(s, cmd, context);
  if (!r.ok) throw Error(r.errorCode);
  return r.state;
}
it('새 준비 기본 설정은 P1/P2, 딜러 미선택(-1)이며 유효하다', () => {
  expect(defaultSettings.names).toEqual(['P1', 'P2']);
  expect(defaultSettings.button).toBe(-1);
  expect(validateSettings(defaultSettings).ok).toBe(true);
});
it('구형 준비 데이터의 추가 순서는 최초 편집 시 기존 순서로 복원', () => {
  const s = createTournament({ ...defaultSettings, button: 0 }, context);
  delete s.setupOrder;
  const next = apply(s, {
    type: 'SETUP_UPDATE',
    settings: { ...s.settings, names: ['P1', 'P2', 'P3'] },
  });
  expect(next.setupOrder).toEqual(next.players.map((p) => p.id));
});
