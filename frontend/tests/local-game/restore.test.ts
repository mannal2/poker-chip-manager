import { it, expect } from 'vitest';
import { validateStored } from '../../src/features/local-game/storage/restore';
import { fixtureState } from '../game/helpers';
import { createTournament } from '../../src/game/transition';
it('10명 게임과 최대 칩 총량을 복원한다', () => {
  const state = fixtureState(10);
  expect(() => validateStored({ schemaVersion: 1, rulesVersion: 1, eventSequence: 0, state })).not.toThrow();
  const maximum = createTournament({ ...state.settings, initial: 1000000 }, { id: 'max', at: 'test' });
  expect(maximum.initialTotal).toBe(10000000);
  expect(() => validateStored({ schemaVersion: 1, rulesVersion: 1, eventSequence: 0, state: maximum })).not.toThrow();
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
