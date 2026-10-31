package xyz.jwlee.poker.server.registry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.room.CommandPipeline;
import xyz.jwlee.poker.server.room.CommandRequest;
import xyz.jwlee.poker.server.room.MutableClock;
import xyz.jwlee.poker.server.room.Publication;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.SeatBinding;

class RoomRegistryTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    // 지정한 다음 한 번의 읽기만 실패하는 시계
    private static final class FailingOnceClock extends Clock {
        private final MutableClock time;
        private boolean fail;

        FailingOnceClock(Instant start) {
            time = new MutableClock(start);
        }

        // 시계를 앞으로 돌린다
        void advance(Duration by) {
            time.advance(by);
        }

        // 다음 읽기가 실패하게 한다
        void failNextRead() {
            fail = true;
        }

        @Override
        public Instant instant() {
            if (fail) {
                fail = false;
                throw new RoomException("ROOM_NOT_FOUND");
            }
            return time.instant();
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }

    // 잠금 안에서 참가자가 방을 떠나는 명령을 실행한다
    private static void leave(Room room, String participantId) {
        new CommandPipeline().execute(room, participantId, new CommandRequest(
                1, null, "leave", 1, 1, room.version(), null, "LEAVE", MAPPER.readTree("{}")));
    }

    private final AtomicInteger seq = new AtomicInteger();
    private final List<Publication> published = new ArrayList<>();
    private final RoomRegistry registry = new RoomRegistry(
            () -> "id" + seq.incrementAndGet(), Clock.systemUTC(), published::add);

    // 참가자에게 구독 연결을 붙인다. 버전은 그대로 둔다
    private void subscribe(RoomRegistry.Entry entry, String connectionId) {
        registry.update(entry.roomId(),
                room -> room.presence().attach(entry.participantId(), connectionId, Instant.EPOCH));
    }

    // 알림이 하나일 때 그 수신 연결들을 돌려준다
    private List<String> onlyPublishedRecipients() {
        assertThat(published).hasSize(1);
        return published.getFirst().deliveries().stream().map(Publication.Delivery::connectionId).toList();
    }

    // 알림을 받는 순간 방 잠금이 풀려 있는지 확인한다
    @Test
    void publishRunsAfterTheRoomLockIsReleased() {
        AtomicBoolean checked = new AtomicBoolean();
        AtomicReference<Room> seen = new AtomicReference<>();
        RoomRegistry locks = new RoomRegistry(() -> "id" + seq.incrementAndGet(), Clock.systemUTC(), publication -> {
            assertThat(seen.get().lock().isHeldByCurrentThread()).isFalse();
            checked.set(true);
        });
        var entry = locks.create("Host");
        locks.update(entry.roomId(), room -> {
            seen.set(room);
            room.presence().attach(entry.participantId(), "conn", Instant.EPOCH);
            return room.bumpVersion();
        });

        assertThat(checked).isTrue();
    }

    // 작업이 예외를 던져도 방 잠금이 풀리는지 확인한다
    @Test
    void aFailingUpdateReleasesTheRoomLock() {
        var entry = registry.create("Host");
        AtomicReference<Room> seen = new AtomicReference<>();

        assertThatThrownBy(() -> registry.update(entry.roomId(), room -> {
            seen.set(room);
            throw new IllegalStateException("boom");
        })).hasMessage("boom");

        assertThat(seen.get().lock().isLocked()).isFalse();
    }

    // 작업이 바꾼 뒤 실패해도 이미 생긴 변경을 알리고 닫힌 방을 지우는지 확인한다
    @Test
    void anUpdateFailingAfterItsChangePublishesThatChangeAndRemovesAClosedRoom() {
        var entry = registry.create("Host");
        subscribe(entry, "conn");

        assertThatThrownBy(() -> registry.update(entry.roomId(), room -> {
            leave(room, entry.participantId());
            throw new IllegalStateException("boom");
        })).hasMessage("boom");

        assertThat(published.getFirst().revokedConnections()).containsExactly("conn");
        assertThat(registry.roomIds()).isEmpty();
    }

    // 방을 닫은 변경은 끊을 연결을 알린 뒤 방을 표에서 빼는지 확인한다
    @Test
    void anUpdateClosingTheRoomPublishesAndRemovesIt() {
        var entry = registry.create("Host");
        subscribe(entry, "conn");

        registry.update(entry.roomId(), room -> {
            leave(room, entry.participantId());
            return null;
        });

        assertThat(published.getFirst().revokedConnections()).containsExactly("conn");
        assertThat(registry.roomIds()).isEmpty();
        assertThat(registry.findByCode(entry.code())).isEmpty();
    }

    // 알림 실패가 변경 결과를 바꾸거나 닫힌 방 제거를 막지 않는지 확인한다
    @Test
    void aFailingPublishNeitherFailsTheUpdateNorKeepsAClosedRoom() {
        RoomRegistry failing = new RoomRegistry(() -> "id" + seq.incrementAndGet(), Clock.systemUTC(), publication -> {
            throw new IllegalStateException("socket trouble");
        });
        var entry = failing.create("Host");
        failing.update(entry.roomId(), room -> room.presence().attach(entry.participantId(), "conn", Instant.EPOCH));

        String answer = failing.update(entry.roomId(), room -> {
            leave(room, entry.participantId());
            return "done";
        });

        assertThat(answer).isEqualTo("done");
        assertThat(failing.roomIds()).isEmpty();
    }

    // 없는 방의 변경은 찾을 수 없다고 답하는지 확인한다
    @Test
    void updatingAMissingRoomIsNotFound() {
        assertThatThrownBy(() -> registry.update("nope", room -> null))
                .isInstanceOfSatisfying(RoomException.class, e -> assertThat(e.code()).isEqualTo("ROOM_NOT_FOUND"));
    }

    // 방 생성도 수집을 거쳐 그 뒤 변화 없는 변경은 알림을 만들지 않는지 확인한다
    @Test
    void creatingARoomLeavesNothingToPublishAfterwards() {
        var entry = registry.create("Host");

        subscribe(entry, "conn");

        assertThat(published).isEmpty();
    }

    // 새 참가자가 들어오면 구독자가 이전 버전과 함께 알림을 받는지 확인한다
    @Test
    void joiningNotifiesTheSubscribers() {
        var host = registry.create("Host");
        subscribe(host, "conn");

        registry.join(host.code(), "Guest");

        assertThat(onlyPublishedRecipients()).containsExactly("conn");
        assertThat(published.getFirst().deliveries().getFirst().message().get("previousVersion").asLong())
                .isEqualTo(host.stateVersion());
    }

    // 이미 앉아 있는 사람의 재입장은 알림을 만들지 않는지 확인한다
    @Test
    void aJoinThatChangesNothingPublishesNothing() {
        SeatBinding[] held = new SeatBinding[1];
        var host = registry.create("Host", (roomId, binding) -> held[0] = binding);
        subscribe(host, "conn");

        registry.join(host.code(), "Ignored", roomId -> Optional.of(held[0]), (r, b) -> { }, n -> n);

        assertThat(published).isEmpty();
    }

    // 시간 규칙 점검으로 생긴 변경도 알림으로 나가는지 확인한다
    @Test
    void aSweepPublishesWhatItChanged() {
        MutableClock clock = new MutableClock(Instant.parse("2026-10-31T00:00:00Z"));
        List<Publication> sent = new ArrayList<>();
        RoomRegistry timed = new RoomRegistry(() -> "id" + seq.incrementAndGet(), clock, sent::add);
        var host = timed.create("Host");
        timed.join(host.code(), "Guest");
        timed.update(host.roomId(), room -> room.presence().attach(host.participantId(), "conn", clock.instant()));
        clock.advance(Duration.ofSeconds(30));

        timed.sweepAll();

        assertThat(sent).singleElement().satisfies(p -> assertThat(p.deliveries()).singleElement()
                .satisfies(d -> assertThat(d.connectionId()).isEqualTo("conn")));
    }

    // 한 방의 뜻밖의 실패는 기록만 남기고 다른 방의 점검을 막지 않는지 확인한다
    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void anUnexpectedSweepFailureIsLoggedAndTheOtherRoomsStillSweep(CapturedOutput output) {
        FailingOnceClock clock = new FailingOnceClock(Instant.parse("2026-10-31T00:00:00Z"));
        RoomRegistry timed = new RoomRegistry(() -> "id" + seq.incrementAndGet(), clock, publication -> { });
        timed.create("One");
        timed.create("Two");
        clock.advance(Duration.ofSeconds(30));
        // 방 규칙 안에서 난 ROOM_NOT_FOUND는 방이 사라졌다는 뜻이 아니다.
        clock.failNextRead();

        timed.sweepAll();

        assertThat(timed.roomIds()).hasSize(1);
        assertThat(output).contains("Room sweep failed");
    }

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
