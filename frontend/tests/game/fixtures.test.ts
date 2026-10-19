import { it, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../shared/game-fixtures/schema.json';
import settings from '../../../shared/game-fixtures/settings.json';
import positions from '../../../shared/game-fixtures/positions.json';
import betting from '../../../shared/game-fixtures/betting.json';
import pots from '../../../shared/game-fixtures/pots.json';
import settlement from '../../../shared/game-fixtures/settlement.json';
import lifecycle from '../../../shared/game-fixtures/lifecycle.json';
import { validateSettings } from '../../src/game/settings';
import { createTournament, transition } from '../../src/game/transition';
import { assertInvariants } from '../../src/game/invariants';
import type { GameCommand } from '../../src/game/types';
const validate = new Ajv({ allErrors: true }).compile(schema);
for (const [suite, data] of Object.entries({
  settings,
  positions,
  betting,
  pots,
  settlement,
  lifecycle,
}))
  it(`${suite} 공통 schema`, () => {
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });
for (const f of settings)
  it(f.id, () => expect(validateSettings(f.initialState).ok).toBe(f.expectedStateSubset.ok));
for (const f of lifecycle)
  it(f.id, () => {
    let s = createTournament(f.initialState, f.context);
    const events: string[] = [];
    for (const cmd of f.commands) {
      const before = JSON.stringify(s);
      const r = transition(s, cmd as GameCommand, f.context);
      expect(JSON.stringify(s)).toBe(before);
      if (!r.ok) throw Error(r.errorCode);
      s = r.state;
      assertInvariants(s);
      events.push(...r.events.map((e) => e.type));
    }
    expect(s).toMatchObject(f.expectedStateSubset);
    for (const type of f.expectedEvents) expect(events).toContain(type);
  });
