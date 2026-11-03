package xyz.jwlee.poker.game.model;

// 플레이어가 할 수 있는 베팅 행동 종류
/** Betting actions that appear as player-acted events. */
public enum ActionType {
    CHECK,
    CALL,
    FOLD,
    ALL_IN,
    BET,
    RAISE
}
