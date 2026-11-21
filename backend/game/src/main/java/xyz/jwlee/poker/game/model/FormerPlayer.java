package xyz.jwlee.poker.game.model;

// 자리를 넘겼거나 바이인을 취소해 테이블을 떠난 사람의 기록
/** TS {@code formerPlayers} entry; it keeps the id reserved and the entry count of the name. */
public record FormerPlayer(String id, String name, int entry, Reason reason) {
    // 테이블을 떠난 이유(자리를 넘김 또는 바이인 취소)
    public enum Reason {
        REPLACED,
        CANCELLED
    }
}
