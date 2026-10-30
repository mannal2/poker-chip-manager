package xyz.jwlee.poker.server.registry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.server.room.RoomException;

class RoomRegistryTest {

    private final AtomicInteger seq = new AtomicInteger();
    private final RoomRegistry registry = new RoomRegistry(() -> "id" + seq.incrementAndGet(), Clock.systemUTC());

    @Test
    void createsUpToTenRoomsThenRefuses() {
        for (int i = 0; i < 10; i++) {
            registry.create("host" + i);
        }
        assertThatThrownBy(() -> registry.create("late"))
                .isInstanceOfSatisfying(RoomException.class, e -> assertThat(e.code()).isEqualTo("ROOM_LIMIT"));
        assertThat(registry.size()).isEqualTo(10);
    }

    @Test
    void aRemovedRoomFreesItsSlotAndItsCode() {
        var first = registry.create("host");
        for (int i = 0; i < 9; i++) {
            registry.create("h" + i);
        }
        registry.remove(first.roomId());
        assertThat(registry.findByCode(first.code())).isEmpty();
        registry.create("again");
        assertThat(registry.size()).isEqualTo(10);
    }

    @Test
    void createdRoomHasTheHostAsItsOnlyParticipant() {
        var entry = registry.create("Host");
        assertThat(registry.<Integer>withRoom(entry.roomId(), room -> room.participants().size())).isEqualTo(1);
        assertThat(registry.<String>withRoom(entry.roomId(), room -> room.hostId())).isEqualTo(entry.participantId());
    }

    @Test
    void joinFindsTheRoomByCaseInsensitiveCode() {
        var entry = registry.create("Host");
        var joined = registry.join(entry.code().toLowerCase(), "Guest");
        assertThat(joined.roomId()).isEqualTo(entry.roomId());
    }

    @Test
    void joinWithAnUnknownCodeIsNotFound() {
        assertThatThrownBy(() -> registry.join("ZZZZZZ", "Guest"))
                .isInstanceOfSatisfying(RoomException.class, e -> assertThat(e.code()).isEqualTo("ROOM_NOT_FOUND"));
    }

    @Test
    void twentyConcurrentCreationsYieldExactlyTenRooms() throws Exception {
        int threads = 20;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<String>> results = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            int n = i;
            results.add(pool.submit(() -> {
                start.await();
                try {
                    registry.create("host" + n);
                    return "OK";
                } catch (RoomException e) {
                    return e.code();
                }
            }));
        }
        start.countDown();
        int ok = 0;
        int refused = 0;
        for (Future<String> f : results) {
            String r = f.get();
            if (r.equals("OK")) {
                ok++;
            } else if (r.equals("ROOM_LIMIT")) {
                refused++;
            }
        }
        pool.shutdown();
        assertThat(ok).isEqualTo(10);
        assertThat(refused).isEqualTo(10);
        assertThat(registry.size()).isEqualTo(10);
    }

    @Test
    void concurrentJoinsNeverExceedTenParticipants() throws Exception {
        var entry = registry.create("Host");
        int threads = 20;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> fs = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            int n = i;
            fs.add(pool.submit(() -> {
                start.await();
                try {
                    registry.join(entry.code(), "g" + n);
                } catch (RoomException ignored) {
                    // ROOM_FULL expected for the late ones
                }
                return null;
            }));
        }
        start.countDown();
        for (Future<?> f : fs) {
            f.get();
        }
        pool.shutdown();
        assertThat(registry.<Integer>withRoom(entry.roomId(), room -> room.participants().size())).isEqualTo(10);
    }
}
