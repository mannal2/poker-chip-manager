package xyz.jwlee.poker.server.realtime;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.support.IdGenerator;

// 1초마다 연결을 돌며 PING을 보내고 구독하지 않거나 응답이 없거나 전송이 멈춘 연결을 닫는다
/** A PONG only moves the connection's deadline: nothing here changes a room or its state version. */
@Component
public final class HeartbeatTask {

    private static final long TICK_MILLIS = 1000;
    private static final Duration PING_INTERVAL = Duration.ofSeconds(15);
    private static final Duration PONG_TIMEOUT = Duration.ofSeconds(45);
    private static final Duration SEND_STALL_LIMIT = Duration.ofSeconds(10);
    private static final Duration SUBSCRIBE_DEADLINE = Duration.ofSeconds(10);

    private final ConnectionHub hub;
    private final RoomRegistry registry;
    private final Clock clock;
    private final IdGenerator ids;

    HeartbeatTask(ConnectionHub hub, RoomRegistry registry, Clock clock, IdGenerator ids) {
        this.hub = hub;
        this.registry = registry;
        this.clock = clock;
        this.ids = ids;
    }

    // 모든 연결을 한 번 점검한다
    @Scheduled(fixedDelay = TICK_MILLIS)
    void tick() {
        Instant now = clock.instant();
        for (Connection connection : hub.connections()) {
            if (expired(connection, now)) {
                connection.close();
            } else if (!now.isBefore(connection.lastPing().plus(PING_INTERVAL))) {
                connection.ping(ids.next(), stateVersion(connection.roomId()));
            }
        }
    }

    // 구독 기한이나 응답 기한이 지났거나 전송이 멈췄는지 확인한다
    private static boolean expired(Connection connection, Instant now) {
        boolean silent = !now.isBefore(connection.lastPong().plus(PONG_TIMEOUT));
        boolean stalled = connection.sendingSince()
                .filter(since -> !now.isBefore(since.plus(SEND_STALL_LIMIT))).isPresent();
        boolean neverSubscribed = connection.roomId() == null
                && !now.isBefore(connection.openedAt().plus(SUBSCRIBE_DEADLINE));
        return silent || stalled || neverSubscribed;
    }

    // 구독한 방의 현재 상태 버전을 읽고 방이 없으면 null을 돌려준다
    private Long stateVersion(String roomId) {
        try {
            return registry.withRoom(roomId, Room::version);
        } catch (RoomException gone) {
            return null;
        }
    }
}
