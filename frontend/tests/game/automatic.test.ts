import { it, expect } from 'vitest';
import { createTournament, transition } from '../../src/game/transition';
import { defaultSettings } from '../../src/game/settings';
import type { GameState, GameCommand } from '../../src/game/types';
const c = { id: 'automatic', at: '2026-10-18T00:00:00Z' };
function act(s: GameState, command: GameCommand) {
  const r = transition(s, command, c);
  if (!r.ok) throw Error(r.errorCode);
  return r.state;
}
function start() {
  return act(createTournament({ ...defaultSettings, button: 0 }, c), { type: 'START_TOURNAMENT' });
}
it('베팅 완료는 같은 저장 변경에서 다음 스트리트, B만 초기화·H 유지·취소 잠금', () => {
  let s = start();
  s = act(s, { type: 'CALL' });
  const before = s.version;
  s = act(s, { type: 'CHECK' });
  expect(s.version).toBe(before + 1);
  expect(s.hand).toMatchObject({ street: 1, phase: 'betting', actorId: 'p1', W: 0, R: 10 });
  expect(s.players.map((p) => p.H)).toEqual([10, 10]);
  expect(s.players.map((p) => p.B)).toEqual([0, 0]);
  expect(s.undo).toBeNull();
  expect(transition(s, { type: 'UNDO' }, c).ok).toBe(false);
  for (let i = 0; i < 6; i++) s = act(s, { type: 'CHECK' });
  expect(s.hand).toMatchObject({ street: 3, phase: 'settlement', actorId: null });
});
it('올인 응답 완료는 공개/시작 명령 없이 승자 선택', () => {
  let s = act(start(), { type: 'ALL_IN' });
  s = act(s, { type: 'CALL' });
  expect(s.hand).toMatchObject({ phase: 'settlement', showdown: true, actorId: null });
  expect(s.undo).toBeNull();
  expect(s.pot).toBe(2000);
});
it('이전 저장의 공개 대기·공개 완료를 한 번 정규화', () => {
  for (const phase of ['revealPending', 'revealed'] as const) {
    const s = act(start(), { type: 'CALL' });
    s.hand!.phase = phase;
    s.hand!.actorId = null;
    s.hand!.pending = [];
    s.hand!.showdown = false;
    const restored = act(s, { type: 'RESUME_FLOW' });
    expect(restored.hand).toMatchObject({ street: 1, phase: 'betting' });
    expect(transition(restored, { type: 'RESUME_FLOW' }, c).ok).toBe(false);
  }
});
