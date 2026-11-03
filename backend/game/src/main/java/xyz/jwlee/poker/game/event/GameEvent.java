package xyz.jwlee.poker.game.event;

// 게임에서 발생한 이벤트 하나(식별자, 시각, 핸드 번호, 상세)
/** {@code hand} is the hand number (0 outside a hand). */
public record GameEvent(String id, String at, String tournamentId, int hand, EventDetails details) {
    public String type() {
        return details.type();
    }
}
