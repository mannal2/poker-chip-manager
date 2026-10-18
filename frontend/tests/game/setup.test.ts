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
it('새 준비는 P1/P2, 딜러 미선택이며 선택 전 시작 불가', () => {
  expect(defaultSettings.names).toEqual(['P1', 'P2']);
  expect(defaultSettings.button).toBe(-1);
  expect(validateSettings(defaultSettings).ok).toBe(true);
  const s = createTournament(defaultSettings, context);
  expect(transition(s, { type: 'START_TOURNAMENT' }, context).ok).toBe(false);
  const selected = apply(s, { type: 'SETUP_UPDATE', settings: { ...s.settings, button: 1 } });
  expect(apply(selected, { type: 'START_TOURNAMENT' }).hand).toMatchObject({
    buttonSeat: 1,
    sbSeat: 1,
    bbSeat: 0,
  });
});
it('추가 순서는 좌석 이동·이름 변경·삭제 후 재추가와 독립적으로 유지', () => {
  let s = createTournament({ ...defaultSettings, names: ['P1', 'P2'], button: 0 }, context);
  const original = s.players.map((p) => p.id);
  s = apply(s, { type: 'SETUP_UPDATE', settings: { ...s.settings, names: ['P1', 'P2', 'P3'] } });
  const added = s.players[2].id;
  expect(s.setupOrder).toEqual([...original, added]);
  s = apply(s, {
    type: 'SETUP_UPDATE',
    settings: { ...s.settings, names: ['이름변경', 'P1', 'P2'], button: 1 },
    order: [added, ...original],
  });
  expect(s.setupOrder?.at(-1)).toBe(added);
  s = apply(s, {
    type: 'SETUP_UPDATE',
    settings: { ...s.settings, names: ['P1', 'P2'], button: 0 },
    order: original,
  });
  expect(s.setupOrder).toEqual(original);
  s = apply(s, { type: 'SETUP_UPDATE', settings: { ...s.settings, names: ['P1', 'P2', 'P3'] } });
  expect(s.players.map((p) => p.name)).toEqual(['P1', 'P2', 'P3']);
  expect(s.setupOrder?.at(-1)).toBe(s.players[2].id);
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
