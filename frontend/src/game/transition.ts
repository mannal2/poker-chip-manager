import type {
  GameCommand,
  GameEvent,
  GameState,
  TransitionContext,
  TransitionResult,
} from './types';
import { assertInvariants } from './invariants';
import { Invalid, requireRule, type CommandHandler } from './rule';
import { setupHandlers } from './commands/setup';
import { bettingHandlers } from './commands/betting';
import { flowHandlers } from './commands/flow';

export { createTournament } from './tournament';
export { getLegalActions } from './legal';
export { returnUncalled } from './round';

/** Every command type needs a handler; adding a command without one fails to compile. */
const handlers: { [K in GameCommand['type']]: CommandHandler<K> } = {
  ...setupHandlers,
  ...bettingHandlers,
  ...flowHandlers,
};
/** Player actions and payouts that can be undone once. */
const undoable = ['CHECK', 'CALL', 'BET', 'RAISE', 'FOLD', 'ALL_IN', 'SETTLE_HAND'];

export function transition(
  input: GameState,
  cmd: GameCommand,
  c: TransitionContext,
): TransitionResult {
  const s = structuredClone(input),
    events: GameEvent[] = [];
  try {
    // Own keys only: a stored or remote request could name 'toString' or another prototype key.
    requireRule(Object.hasOwn(handlers, cmd.type));
    const handler = handlers[cmd.type] as CommandHandler<GameCommand['type']>;
    handler(s, cmd, c, events);
    if (undoable.includes(cmd.type)) {
      const { undo: ignored, ...snapshot } = structuredClone(input);
      void ignored;
      s.undo = { ...snapshot, eventIds: events.map((event) => event.id) };
    }
    s.version = input.version + 1;
    assertInvariants(s);
    return { ok: true, state: s, events };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, errorCode: e.message };
    throw e;
  }
}
