package xyz.jwlee.poker.game;

// 행동이 막힌 이유를 나타내는 코드
/** Why the current actor cannot (re-)raise, or why nobody can act. */
public enum LegalReasonCode {
    NOT_ACTOR,
    NO_OPPONENT,
    RAISE_CLOSED
}
