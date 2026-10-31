package xyz.jwlee.poker.server.registry;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.room.CommandPipeline;
import xyz.jwlee.poker.server.room.CommandRequest;
import xyz.jwlee.poker.server.room.MutableClock;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomEnv;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.RoomLifecycle;
import xyz.jwlee.poker.server.room.RoomPhase;
import xyz.jwlee.poker.server.support.IdGenerator;

/** A reconnect racing the 30-minute deletion: the room survives with that person connected, or it is gone (M13). */
class RoomSweepRaceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    // 두 사람이 게임을 시작한 뒤 전원 끊긴 방을 만든다
    private static void startAndLeave(Room room, String hostId, String guestId, RoomEnv env) {
        CommandPipeline pipeline = new CommandPipeline(env.clock(), env.ids());
        RoomLifecycle.connected(room, hostId, "host-conn", env);
        RoomLifecycle.connected(room, guestId, "guest-conn", env);
        pipeline.execute(room, hostId, new CommandRequest(1, null, "r1", 1, 1, room.version(), null, "SET_DEALER",
                MAPPER.readTree("{\"participantId\":\"" + hostId + "\"}")));
        pipeline.execute(room, hostId, new CommandRequest(1, null, "r2", 2, 1, room.version(), null, "START",
                MAPPER.readTree("{}")));
        assertThat(room.phase()).isEqualTo(RoomPhase.PLAYING);
        RoomLifecycle.disconnected(room, "host-conn", env);
        RoomLifecycle.disconnected(room, "guest-conn", env);
    }

    @Test
    void aReconnectRacingTheSweepEitherKeepsTheRoomWithThatPersonOrFindsItGone() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 100; round++) {
                AtomicInteger counter = new AtomicInteger();
                IdGenerator ids = () -> "id" + counter.incrementAndGet();
                MutableClock clock = new MutableClock(Instant.parse("2026-10-31T00:00:00Z"));
                RoomEnv env = new RoomEnv(clock, ids);
                RoomRegistry registry = new RoomRegistry(ids, clock);
                RoomRegistry.Entry host = registry.create("Host");
                RoomRegistry.Entry guest = registry.join(host.code(), "Guest");
                String roomId = host.roomId();
                registry.withRoom(roomId, room -> {
                    startAndLeave(room, host.participantId(), guest.participantId(), env);
                    return null;
                });
                clock.advance(Duration.ofMinutes(30));
                CountDownLatch go = new CountDownLatch(1);

                Future<Boolean> reconnect = pool.submit(() -> {
                    go.await();
                    try {
                        return registry.withRoom(roomId, room -> {
                            RoomLifecycle.connected(room, guest.participantId(), "back", env);
                            return true;
                        });
                    } catch (RoomException e) {
                        assertThat(e.code()).isEqualTo("ROOM_NOT_FOUND");
                        return false;
                    }
                });
                Future<?> sweep = pool.submit(() -> {
                    go.await();
                    registry.sweepAll();
                    return null;
                });
                go.countDown();
                boolean reconnected = reconnect.get();
                sweep.get();

                if (reconnected) {
                    assertThat(registry.roomIds()).as("round %d", round).containsExactly(roomId);
                    assertThat(registry.<Boolean>withRoom(roomId,
                            room -> room.presence().isConnected(guest.participantId()))).isTrue();
                } else {
                    assertThat(registry.roomIds()).as("round %d", round).isEmpty();
                }
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // 닫히는 방은 표에서 빠지고 다른 방은 남는지 확인한다
    @Test
    void sweepAllRemovesOnlyClosedRooms() {
        AtomicInteger counter = new AtomicInteger();
        IdGenerator ids = () -> "id" + counter.incrementAndGet();
        MutableClock clock = new MutableClock(Instant.parse("2026-10-31T00:00:00Z"));
        RoomEnv env = new RoomEnv(clock, ids);
        RoomRegistry registry = new RoomRegistry(ids, clock);
        RoomRegistry.Entry gone = registry.create("Gone");
        clock.advance(Duration.ofSeconds(20));
        RoomRegistry.Entry stays = registry.create("Stays");
        registry.withRoom(stays.roomId(), room -> {
            RoomLifecycle.connected(room, stays.participantId(), "conn", env);
            return null;
        });
        clock.advance(Duration.ofSeconds(10));

        registry.sweepAll();

        assertThat(registry.roomIds()).containsExactly(stays.roomId());
        assertThat(registry.findByCode(gone.code())).isEmpty();
    }
}
