import { it, expect } from 'vitest';
import { createTournament, transition } from '../../src/game/transition';
import { defaultSettings } from '../../src/game/settings';
import type { GameCommand } from '../../src/game/types';
import { fixtureState, ctx } from './helpers';

const raw = (command: object) => command as GameCommand;

it('알 수 없는 명령과 필드가 빠진 명령은 상태를 바꾸지 않고 코드로 거절한다', () => {
  const playing = fixtureState(3);
  const setup = createTournament({ ...defaultSettings, button: 0 }, ctx);
  for (const [state, command, code] of [
    [playing, { type: 'SET_VIEW', viewSeat: 1 }, 'INVALID_ACTION'],
    [setup, { type: 'SET_VIEW', viewSeat: 1 }, 'INVALID_ACTION'],
    [playing, { type: 'NOPE' }, 'INVALID_ACTION'],
    [playing, { type: 'toString' }, 'INVALID_ACTION'],
    [playing, { type: 'constructor' }, 'INVALID_ACTION'],
    [playing, { type: 'RAISE' }, 'INVALID_AMOUNT'],
    [playing, { type: 'SCHEDULE_BLINDS', sb: 10 }, 'INVALID_BLINDS'],
    [playing, { type: 'SETTLE_HAND' }, 'INVALID_ACTION'],
    [setup, { type: 'SETUP_UPDATE' }, 'INVALID_ACTION'],
  ] as const) {
    const before = JSON.stringify(state);
    expect(transition(state, raw(command), ctx), JSON.stringify(command)).toEqual({
      ok: false,
      errorCode: code,
    });
    expect(JSON.stringify(state)).toBe(before);
  }
});
