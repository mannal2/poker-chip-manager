package xyz.jwlee.poker.server.room;

import java.time.Duration;

// 연결이 끊긴 참가자를 기다려 주는 시간(대기방 재접속, 진행 중 자동 행동)을 묶는다
/**
 * {@code waitingReconnect}: how long a waiting-room seat survives a disconnect before the person leaves the roster.
 * {@code autoPlay}: how long a disconnected player in a running game is waited for before the server checks or
 * folds for them; it counts from the disconnect, not from the start of each turn.
 */
public record PresenceGrace(Duration waitingReconnect, Duration autoPlay) {

    public static final PresenceGrace DEFAULT = new PresenceGrace(Duration.ofMinutes(5), Duration.ofSeconds(30));

    // 두 유예가 음수가 아닌지 확인한다
    public PresenceGrace {
        if (waitingReconnect.isNegative() || autoPlay.isNegative()) {
            throw new IllegalArgumentException("A grace cannot be negative");
        }
    }
}
