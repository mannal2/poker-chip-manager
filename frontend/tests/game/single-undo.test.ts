import { it, expect } from 'vitest';
import { fixtureState, apply, ctx } from './helpers';
import { transition } from '../../src/game/transition';
import { historyRows } from '../../src/features/gameplay/model/history';

// State-level undo behavior lives in shared/game-fixtures/undo.json (UNDO01~UNDO04);
// the history-row display of undone events is a UI model and stays here.
it('마지막 폴드 무르기는 폴드와 새 핸드 기록을 함께 지운다', () => {
  const before = apply(fixtureState(2), { type: 'SCHEDULE_BLINDS', sb: 10, bb: 20 });
  const result = transition(before, { type: 'FOLD' }, { ...ctx, id: 'fold' });
  if (!result.ok) throw Error(result.errorCode);
  const undo = transition(result.state, { type: 'UNDO' }, { ...ctx, id: 'undo' });
  if (!undo.ok) throw Error(undo.errorCode);
  expect(historyRows([...result.events, ...undo.events], before.players)).toEqual([]);
});
it('스트리트 전환 무르기는 행동과 단계 기록을 함께 지운다', () => {
  const before = apply(fixtureState(2), { type: 'CALL' });
  const r = transition(before, { type: 'CHECK' }, { ...ctx, id: 'check' });
  if (!r.ok) throw Error(r.errorCode);
  const u = transition(r.state, { type: 'UNDO' }, { ...ctx, id: 'undo' });
  if (!u.ok) throw Error(u.errorCode);
  expect(historyRows([...r.events, ...u.events], before.players)).toEqual([]);
});
