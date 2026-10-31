package xyz.jwlee.poker.game.rule;

// 정산이 불가능한 사유 코드
/** Why a winner selection cannot be settled; each name is also a {@link RuleErrorCode}. */
public enum SettlementErrorCode {
    NO_POT,
    WINNER_REQUIRED,
    TIE_CONFLICT,
    POT_ORDER_CONFLICT
}
