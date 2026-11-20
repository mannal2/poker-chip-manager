import { it, expect } from 'vitest';
import { validateStored } from '../../src/features/local-game/storage/restore';
import { fixtureState } from '../game/helpers';
import { createTournament, transition } from '../../src/game/transition';
it('10명 게임과 최대 칩 총량을 복원한다', () => {
  const state = fixtureState(10);
  expect(() =>
    validateStored({ schemaVersion: 1, rulesVersion: 1, eventSequence: 0, state }),
  ).not.toThrow();
  const maximum = createTournament(
    { ...state.settings, initial: 1000000 },
    { id: 'max', at: 'test' },
  );
  expect(maximum.initialTotal).toBe(10000000);
  expect(() =>
    validateStored({ schemaVersion: 1, rulesVersion: 1, eventSequence: 0, state: maximum }),
  ).not.toThrow();
});
it('설정 총량·이름·핸드 단계·응답자·예약·취소 snapshot 손상을 거절', () => {
  const base = { schemaVersion: 1, rulesVersion: 1, eventSequence: 0, state: fixtureState() };
  const changes = [
    (s: typeof base.state) => {
      s.settings.initial = 2000;
    },
    (s: typeof base.state) => {
      s.players[0].name = '다른이름';
    },
    (s: typeof base.state) => {
      s.hand!.pending.push('missing');
    },
    (s: typeof base.state) => {
      s.pendingBlinds = { sb: 20, bb: 10 };
    },
    (s: typeof base.state) => {
      s.hand!.showdown = undefined as unknown as boolean;
    },
    (s: typeof base.state) => {
      s.undo = { ...structuredClone(s), pot: 123, undo: undefined } as unknown as NonNullable<
        typeof s.undo
      >;
    },
  ];
  for (const change of changes) {
    const saved = structuredClone(base);
    change(saved.state);
    expect(() => validateStored(saved)).toThrow();
  }
});
it('예전 공개 단계 저장은 지원하지 않는 형식으로 원본을 보존한다', () => {
  for (const phase of ['revealPending', 'revealed']) {
    const saved = { schemaVersion: 1, rulesVersion: 1, eventSequence: 0, state: fixtureState() };
    Object.assign(saved.state.hand!, { phase, actorId: null, pending: [], showdown: false });
    const original = structuredClone(saved);
    expect(() => validateStored(saved)).toThrow('저장 핸드 정보가 손상되었습니다.');
    expect(saved).toEqual(original);
  }
});
// 실제 엔진으로 바이인 명령을 적용한 저장 형태를 만든다
function stored(state: ReturnType<typeof fixtureState>) {
  return { schemaVersion: 1 as const, rulesVersion: 1 as const, eventSequence: 0, state };
}
function buyInCtx(state: ReturnType<typeof fixtureState>, cmd: Parameters<typeof transition>[1]) {
  const r = transition(state, cmd, { id: 'T', at: '2026-11-19T00:00:00Z' });
  if (!r.ok) throw Error(r.errorCode);
  return r.state;
}
function boughtIn() {
  return buyInCtx(fixtureState(), {
    type: 'BUY_IN',
    name: 'Carol',
    placement: { kind: 'between', after: 'p1' },
  });
}
it('바이인(사이 자리)·자리 대체·취소로 바뀐 저장도 복원한다', () => {
  const between = boughtIn();
  expect(between.players.length).toBe(4);
  expect(() => validateStored(stored(between))).not.toThrow();

  const base = buyInCtx(fixtureState(), { type: 'FOLD' });
  base.players[0].eliminated = true;
  base.players[1].stack += base.players[0].stack;
  base.players[0].stack = 0;
  const replaced = buyInCtx(base, {
    type: 'BUY_IN',
    name: 'Dan',
    placement: { kind: 'replace', playerId: 'p0' },
  });
  expect(replaced.formerPlayers?.length).toBe(1);
  expect(() => validateStored(stored(replaced))).not.toThrow();

  const cancelled = buyInCtx(between, { type: 'CANCEL_BUY_IN', playerId: between.players[2].id });
  expect(() => validateStored(stored(cancelled))).not.toThrow();
});
it('바이인한 저장의 총량 손상과 살아 있는 중복 이름을 거절한다', () => {
  const badTotal = boughtIn();
  badTotal.initialTotal += 1;
  expect(() => validateStored(stored(badTotal))).toThrow();

  const dup = boughtIn();
  dup.players[2].name = 'a';
  expect(() => validateStored(stored(dup))).toThrow('저장 설정·참가자·총량이 일치하지 않습니다.');
});
