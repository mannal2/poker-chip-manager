import type { RuleErrorCode } from './errors';
import type { GameCommand, GameEvent, GameState, TransitionContext } from './types';

/** Thrown inside command handlers; transition turns it into a rejection result. */
export class Invalid extends Error {
  declare message: RuleErrorCode;
}
export function requireRule(
  condition: unknown,
  message: RuleErrorCode = 'INVALID_ACTION',
): asserts condition {
  if (!condition) throw new Invalid(message);
}
/** Applies one command to a cloned state, appending the events it produces. */
export type CommandHandler<K extends GameCommand['type']> = (
  s: GameState,
  // An intersection, not Extract: grouped members such as CHECK | CALL must narrow to one type.
  cmd: GameCommand & { type: K },
  c: TransitionContext,
  events: GameEvent[],
) => void;
