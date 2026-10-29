import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../shared/game-fixtures/schema.json';
import settings from '../../../shared/game-fixtures/settings.json';
import positions from '../../../shared/game-fixtures/positions.json';
import betting from '../../../shared/game-fixtures/betting.json';
import pots from '../../../shared/game-fixtures/pots.json';
import settlement from '../../../shared/game-fixtures/settlement.json';
import lifecycle from '../../../shared/game-fixtures/lifecycle.json';
import undo from '../../../shared/game-fixtures/undo.json';
import { validateSettings } from '../../src/game/settings';
import {
  createTournament,
  transition,
  getLegalActions,
  returnUncalled,
} from '../../src/game/transition';
import { nextPositions, initialBlindSeats } from '../../src/game/positions';
import { buildPots, previewSettlement } from '../../src/game/settlement';
import { assertInvariants } from '../../src/game/invariants';
import type { GameCommand, GameState, Pot } from '../../src/game/types';

// Fixture format v2: every case carries a full GameState (or the suite's own input) and a
// list of commands; the runner holds no interpretation of compact states.
const suites = { settings, positions, betting, pots, settlement, lifecycle, undo };
export type SuiteName = keyof typeof suites;
type Command = {
  type: string;
  expectError?: string;
  expectedStateSubset?: object;
} & Record<string, unknown>;
/* eslint-disable @typescript-eslint/no-explicit-any */
type Case = {
  id: string;
  initialState: any;
  commands: any[];
  context: { id: string; at: string };
  pots?: Pot[];
  expectedStateSubset: any;
  expectedLegal?: unknown;
  expectedError: string | null;
  expectedEvents: string[];
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const validate = new Ajv({ allErrors: true }).compile(schema);

// Runs one game command, checking the input state is untouched and applying `expectError`.
// A rejected command (expectError) leaves the state as it was for the next command.
// A command's own `expectedStateSubset` is checked (toMatchObject) on the state it leaves behind.
function step(s: GameState, raw: Command, ctx: Case['context'], events?: string[]): GameState {
  const { expectError, expectedStateSubset, ...command } = raw;
  const before = JSON.stringify(s);
  const r = transition(s, command as GameCommand, ctx);
  expect(JSON.stringify(s)).toBe(before);
  if (expectError !== undefined) {
    if (r.ok) throw Error('The command must be rejected.');
    expect(r.errorCode).toBe(expectError);
    if (expectedStateSubset !== undefined) expect(s).toMatchObject(expectedStateSubset);
    return s;
  }
  if (!r.ok) throw Error(r.errorCode);
  assertInvariants(r.state);
  events?.push(...r.events.map((e) => e.type));
  if (expectedStateSubset !== undefined) expect(r.state).toMatchObject(expectedStateSubset);
  return r.state;
}

function runBetting(f: Case) {
  let s: GameState = structuredClone(f.initialState);
  // Case-level expectedError: the last command must be rejected, all earlier ones succeed.
  f.commands.forEach((command, i) => {
    const last = i === f.commands.length - 1;
    s = step(
      s,
      last && f.expectedError ? { ...command, expectError: f.expectedError } : command,
      f.context,
    );
  });
  if (f.expectedError) return;
  if (f.expectedStateSubset) expect(s).toMatchObject(f.expectedStateSubset);
  if (f.expectedLegal) expect(getLegalActions(s)).toMatchObject(f.expectedLegal as object);
}

function runPots(f: Case) {
  const s: GameState = structuredClone(f.initialState);
  const total = s.pot;
  let built: Pot[] = [];
  for (const command of f.commands) {
    if (command.type === 'RETURN_UNCALLED') {
      const returned = returnUncalled(s);
      expect(returned?.amount ?? 0).toBe(f.expectedStateSubset.returnAmount);
      expect(s.pot).toBe(total - (returned?.amount ?? 0));
    } else if (command.type === 'BUILD_POTS') {
      built = buildPots(s);
    } else throw Error(`Unknown pots command ${command.type}`);
  }
  expect(built.map((x) => x.amount)).toEqual(f.expectedStateSubset.amounts);
  expect(built.map((x) => x.eligible)).toEqual(f.expectedStateSubset.eligible);
}

function runSettlement(f: Case) {
  const s: GameState = structuredClone(f.initialState);
  for (const command of f.commands) {
    if (command.type !== 'PREVIEW_SETTLEMENT')
      throw Error(`Unknown settlement command ${command.type}`);
    const r = previewSettlement(s, command.winners, f.pots ?? buildPots(s));
    expect(r.ok).toBe(f.expectedStateSubset.ok);
    if (f.expectedStateSubset.payouts) expect(r.payouts).toEqual(f.expectedStateSubset.payouts);
    if (f.expectedStateSubset.allocations)
      expect(r.allocations).toMatchObject(f.expectedStateSubset.allocations);
    if (f.expectedStateSubset.pots) expect(buildPots(s)).toEqual(f.expectedStateSubset.pots);
  }
}

function runLifecycle(f: Case) {
  let s = createTournament(f.initialState, f.context);
  const events: string[] = [];
  // Case-level expectedError: the last command must be rejected, all earlier ones succeed.
  f.commands.forEach((command, i) => {
    const last = i === f.commands.length - 1;
    s = step(
      s,
      last && f.expectedError ? { ...command, expectError: f.expectedError } : command,
      f.context,
      events,
    );
  });
  if (f.expectedError) return;
  expect(s).toMatchObject(f.expectedStateSubset);
  for (const type of f.expectedEvents) expect(events).toContain(type);
}

function runPositions(f: Case) {
  let p = f.initialState;
  for (const c of f.commands) {
    if (c.type === 'INITIAL_BLIND_SEATS') {
      // Pseudo command: first-hand blind seats from a chosen button; does not change `p`.
      expect(initialBlindSeats(c.button, c.alive)).toEqual(c.expected);
      continue;
    }
    p = nextPositions(c.alive, p);
    expect(p).toEqual(c.expected);
  }
}

const runners: Record<SuiteName, (f: Case) => void> = {
  settings: (f) => expect(validateSettings(f.initialState).ok).toBe(f.expectedStateSubset.ok),
  positions: runPositions,
  betting: runBetting,
  pots: runPots,
  settlement: runSettlement,
  lifecycle: runLifecycle,
  undo: runLifecycle,
};

export function runFixtureSuite(name: SuiteName) {
  const cases = suites[name] as unknown as Case[];
  describe(`${name} shared fixtures`, () => {
    it(`${name} 공통 schema`, () => {
      expect(validate(cases), JSON.stringify(validate.errors)).toBe(true);
    });
    for (const f of cases) it(f.id, () => runners[name](f));
  });
}
