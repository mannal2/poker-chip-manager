package xyz.jwlee.poker.game.rule;

// 규칙 위반 거절 사유 코드
/** Rule-level rejection codes; names match the TS strings. */
public enum RuleErrorCode {
    INVALID_ACTION,
    INVALID_AMOUNT,
    MIN_RAISE,
    RAISE_CLOSED,
    INVALID_BLINDS,
    DEALER_REQUIRED,
    INVALID_SETTINGS,
    UNDO_LOCKED,
    NO_POT,
    WINNER_REQUIRED,
    TIE_CONFLICT,
    POT_ORDER_CONFLICT
}
