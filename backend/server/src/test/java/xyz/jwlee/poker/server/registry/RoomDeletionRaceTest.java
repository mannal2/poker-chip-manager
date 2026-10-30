package xyz.jwlee.poker.server.registry;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.room.CommandPipeline;
import xyz.jwlee.poker.server.room.CommandRequest;
import xyz.jwlee.poker.server.room.RoomException;

/** The last person leaving races a join: the room must never keep a joiner while being deleted. */
class RoomDeletionRaceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void lastLeaveRacingAJoinLeavesNoZombie() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 300; round++) {
                AtomicInteger ids = new AtomicInteger();
                RoomRegistry registry = new RoomRegistry(() -> "id" + ids.incrementAndGet(), Clock.systemUTC());
                RoomRegistry.Entry host = registry.create("Host");
                CountDownLatch go = new CountDownLatch(1);

                Future<Boolean> leave = pool.submit(() -> {
                    go.await();
                    boolean closed = registry.withRoom(host.roomId(), room -> {
                        // Whatever version the room has by now: only the lock order is under test.
                        CommandRequest request = new CommandRequest(1, null, "r1", 1, 1, room.version(), null,
                                "LEAVE", MAPPER.readTree("{}"));
                        new CommandPipeline().execute(room, host.participantId(), request);
                        return room.isClosed();
                    });
                    if (closed) {
                        registry.remove(host.roomId());
                    }
                    return closed;
                });
                Future<RoomRegistry.Entry> join = pool.submit(() -> {
                    go.await();
                    try {
                        return registry.join(host.code(), "Guest");
                    } catch (RoomException e) {
                        assertThat(e.code()).isEqualTo("ROOM_NOT_FOUND");
                        return null;
                    }
                });
                go.countDown();
                boolean closed = leave.get();
                RoomRegistry.Entry joined = join.get();

                List<String> remaining = new ArrayList<>(registry.roomIds());
                if (joined == null) {
                    assertThat(closed).as("round %d: join refused means the room closed", round).isTrue();
                    assertThat(remaining).isEmpty();
                } else if (closed) {
                    // The join ran first: the host leaving then was not the last person, so nothing closed.
                    throw new AssertionError("round " + round + ": room closed with a joiner in it");
                } else {
                    assertThat(remaining).containsExactly(host.roomId());
                    assertThat(registry.<Integer>withRoom(host.roomId(), room -> room.participants().size()))
                            .isEqualTo(1);
                }
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
