import type { RuleErrorCode } from './errors';
import type { GameCommand, GameEvent, GameState, TransitionContext } from './types';

// 규칙 위반을 나타내는 예외로, 거절 코드를 메시지로 담는다
/** Thrown inside command handlers; transition turns it into a rejection result. */
export class Invalid extends Error {
  declare message: RuleErrorCode;
}
// 조건이 거짓이면 지정한 코드로 규칙 위반 예외를 던진다
export function requireRule(
  condition: unknown,
  message: RuleErrorCode = 'INVALID_ACTION',
): asserts condition {
  if (!condition) throw new Invalid(message);
}
// 특정 명령 하나를 상태에 적용하는 핸들러 형식
/** Applies one command to a cloned state, appending the events it produces. */
export type CommandHandler<K extends GameCommand['type']> = (
  s: GameState,
  // An intersection, not Extract: grouped members such as CHECK | CALL must narrow to one type.
  cmd: GameCommand & { type: K },
  c: TransitionContext,
  events: GameEvent[],
) => void;
