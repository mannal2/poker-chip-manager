import { it, expect } from 'vitest';
import { fixtureState, apply, ctx } from './helpers';
import { transition, getLegalActions } from '../../src/game/transition';
import { validateStored } from '../../src/local/restore';
import { historyRows } from '../../src/ui/history';
import type { GameState } from '../../src/game/types';
function restored(s: GameState) {
  const value = JSON.parse(
    JSON.stringify({ schemaVersion: 1, rulesVersion: 1, eventSequence: 100, state: s }),
  );
  validateStored(value);
  return value.state as GameState;
}
function matchesUndo(after: GameState, before: GameState) {
  const undone = apply(restored(after), { type: 'UNDO' });
  expect(undone).toEqual({ ...before, version: after.version + 1, undo: null });
  expect(transition(undone, { type: 'UNDO' }, ctx).ok).toBe(false);
  return undone;
}
it('스트리트 종료 체크를 한 번 복원하고 새 행동 후에만 다시 무른다', () => {
  const before = apply(fixtureState(2), { type: 'CALL' });
  const after = apply(before, { type: 'CHECK' });
  expect(after.hand?.street).toBe(1);
  const undone = matchesUndo(after, before);
  matchesUndo(apply(undone, { type: 'CHECK' }), undone);
});
it('마지막 폴드의 반환·지급·새 핸드·예약 블라인드를 모두 복원한다', () => {
  const before = apply(fixtureState(2), { type: 'SCHEDULE_BLINDS', sb: 10, bb: 20 });
  const result = transition(before, { type: 'FOLD' }, { ...ctx, id: 'fold' });
  if (!result.ok) throw Error(result.errorCode);
  expect(result.state.hand).toMatchObject({ number: 2, sb: 10, bb: 20 });
  matchesUndo(result.state, before);
  const undo = transition(result.state, { type: 'UNDO' }, { ...ctx, id: 'undo' });
  if (!undo.ok) throw Error(undo.errorCode);
  expect(historyRows([...result.events, ...undo.events], before.players)).toEqual([]);
});
it('쇼다운 지급과 토너먼트 종료도 한 번만 복원한다', () => {
  const before = apply(apply(fixtureState(2), { type: 'ALL_IN' }), { type: 'CALL' });
  const after = apply(before, { type: 'SETTLE_HAND', winners: { pot0: ['p0'] } });
  expect(after.status).toBe('ended');
  matchesUndo(after, before);
});
it('다음 핸드 새 행동은 이전 핸드까지 돌아가지 않는다', () => {
  const next = apply(fixtureState(2), { type: 'FOLD' });
  const after = apply(next, { type: getLegalActions(next).canCall ? 'CALL' : 'CHECK' });
  expect(matchesUndo(after, next).hand?.number).toBe(2);
});
it('스트리트 전환 무르기는 행동과 단계 기록을 함께 지운다', () => {
  const before = apply(fixtureState(2), { type: 'CALL' });
  const r = transition(before, { type: 'CHECK' }, { ...ctx, id: 'check' });
  if (!r.ok) throw Error(r.errorCode);
  const u = transition(r.state, { type: 'UNDO' }, { ...ctx, id: 'undo' });
  if (!u.ok) throw Error(u.errorCode);
  expect(historyRows([...r.events, ...u.events], before.players)).toEqual([]);
});
