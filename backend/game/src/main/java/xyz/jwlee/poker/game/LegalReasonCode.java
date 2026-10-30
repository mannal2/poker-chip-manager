package xyz.jwlee.poker.game;

/** Why the current actor cannot (re-)raise, or why nobody can act. */
public enum LegalReasonCode {
    NOT_ACTOR,
    NO_OPPONENT,
    RAISE_CLOSED
}
