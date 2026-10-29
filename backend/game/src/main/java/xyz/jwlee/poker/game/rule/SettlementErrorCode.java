package xyz.jwlee.poker.game.rule;

/** Why a winner selection cannot be settled; each name is also a {@link RuleErrorCode}. */
public enum SettlementErrorCode {
    NO_POT,
    WINNER_REQUIRED,
    TIE_CONFLICT,
    POT_ORDER_CONFLICT
}
