package xyz.jwlee.poker.server.registry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.registry.RoomRegistry.Entry;
import xyz.jwlee.poker.server.registry.RoomRegistry.PrepareResult;
import xyz.jwlee.poker.server.room.CommandPipeline;
import xyz.jwlee.poker.server.room.CommandRequest;
import xyz.jwlee.poker.server.room.Publication;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomEnv;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.RoomLifecycle;
import xyz.jwlee.poker.server.room.RoomPhase;
import xyz.jwlee.poker.server.room.RoomPublisher;
import xyz.jwlee.poker.server.room.StartGate;
import xyz.jwlee.poker.server.support.IdGenerator;

// 배포 준비와 게임 시작이 겹쳐도 교체 허용과 시작 성공이 함께 나오지 않는지 검사한다
/** O03: a START or a result-screen UNDO that succeeds is never paired with a READY. */
class DeployPrepareRaceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int ROUNDS = 100;
    private static final int IDLE_ROOMS = 400;
    private static final int MAX_JITTER_NANOS = 60_000;

    // 게이트, 레지스트리, 파이프라인과 시작 직전의 방 하나를 묶은 판
    private static final class Table {
        final AtomicInteger counter = new AtomicInteger();
        final IdGenerator ids = () -> "id" + counter.incrementAndGet();
        final Clock clock = Clock.systemUTC();
        final StartGate gate = new StartGate();
        final List<Publication> published = Collections.synchronizedList(new ArrayList<>());
        final RoomRegistry registry;
        final RoomEnv env = new RoomEnv(clock, ids, gate);
        final CommandPipeline pipeline = new CommandPipeline(clock, ids, gate);
        final Entry host;
        final Entry guest;
        final String roomId;
        private long hostSequence;
        private long guestSequence;

        // 발행을 기록하는 판을 만든다
        Table() {
            this(null);
        }

        // 두 사람을 연결하고 딜러를 정해 시작 직전까지 준비한다
        Table(RoomPublisher publisher) {
            registry = new RoomRegistry(ids, clock, publisher == null ? published::add : publisher, IDLE_ROOMS + 2, gate);
            host = registry.create("Host");
            guest = registry.join(host.code(), "Guest");
            roomId = host.roomId();
            registry.update(roomId, room -> {
                RoomLifecycle.connected(room, host.participantId(), "host-conn", env);
                RoomLifecycle.connected(room, guest.participantId(), "guest-conn", env);
                return null;
            });
            assertThat(hostCommand("SET_DEALER", "{\"participantId\":\"" + host.participantId() + "\"}", false))
                    .isEqualTo("OK");
        }

        // 방장 명령을 현재 버전으로 보내고 결과 코드를 돌려준다
        String hostCommand(String type, String payload, boolean scoped) {
            return command(host.participantId(), ++hostSequence, type, payload, scoped);
        }

        // 손님 명령을 현재 버전으로 보내고 결과 코드를 돌려준다
        String guestCommand(String type, String payload, boolean scoped) {
            return command(guest.participantId(), ++guestSequence, type, payload, scoped);
        }

        // 지금 방의 토너먼트와 핸드를 담아 명령을 실행한다
        private String command(String who, long sequence, String type, String payload, boolean scoped) {
            return registry.update(roomId, room -> {
                String tournamentId = room.game() == null ? null : room.game().tournamentId;
                String handId = scoped ? room.game().hand.id : null;
                return pipeline.execute(room, who, new CommandRequest(1, tournamentId, who + "-" + sequence, sequence,
                        1, room.version(), handId, type, MAPPER.readTree(payload))).outcome().code();
            });
        }

        // 방 잠금을 이미 잡은 호출자가 공용 잠금 없이 START를 실행한다
        String startHoldingTheRoomLock(Room room) {
            long sequence = ++hostSequence;
            String who = host.participantId();
            return pipeline.execute(room, who, new CommandRequest(1, null, who + "-" + sequence, sequence, 1,
                    room.version(), null, "START", MAPPER.readTree("{}"))).outcome().code();
        }

        // 지금 차례가 방장인지 돌려준다
        boolean hostActs() {
            return registry.withRoom(roomId, room -> room.playerIds().get(host.participantId())
                    .equals(room.game().hand.actorId));
        }

        // 두 사람이 올인해 끝난 결과 화면을 만든다
        void finishGame() {
            assertThat(hostCommand("START", "{}", false)).isEqualTo("OK");
            boolean hostFirst = hostActs();
            assertThat(hostFirst ? hostCommand("ALL_IN", "{}", true) : guestCommand("ALL_IN", "{}", true))
                    .isEqualTo("OK");
            assertThat(hostFirst ? guestCommand("CALL", "{}", true) : hostCommand("CALL", "{}", true))
                    .isEqualTo("OK");
            assertThat(hostCommand("SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}", true)).isEqualTo("OK");
            assertThat(phase()).isEqualTo(RoomPhase.RESULT);
        }

        // 방의 단계를 돌려준다
        RoomPhase phase() {
            return registry.withRoom(roomId, room -> room.phase());
        }

        // 방의 상태 버전을 돌려준다
        long version() {
            return registry.withRoom(roomId, room -> room.version());
        }

        // 방의 안내 값을 돌려준다
        boolean deployPending() {
            return registry.withRoom(roomId, room -> room.deployPending());
        }

        // 준비가 표를 더 오래 훑도록 대기방을 더 만든다
        void addIdleRooms() {
            for (int i = 0; i < IDLE_ROOMS; i++) {
                registry.create("Idle");
            }
        }

        // 구독자가 받은 마지막 스냅샷의 안내 값을 돌려준다
        boolean lastPublishedDeployPending() {
            Publication last = published.getLast();
            return last.deliveries().getFirst().message().get("state").get("deployPending").asBoolean();
        }
    }

    // 경합 한 판의 결과
    private record Race(String code, PrepareResult prepared) { }

    // 게임 명령과 배포 준비를 동시에 출발시켜 두 결과를 함께 돌려준다
    private static Race race(ExecutorService pool, Table table, Supplier<String> command) throws Exception {
        CountDownLatch go = new CountDownLatch(2);
        long jitter = ThreadLocalRandom.current().nextLong(MAX_JITTER_NANOS);
        Future<String> played = pool.submit(() -> {
            go.countDown();
            go.await();
            long until = System.nanoTime() + jitter;
            while (System.nanoTime() < until) {
                Thread.onSpinWait();
            }
            return command.get();
        });
        Future<PrepareResult> prepared = pool.submit(() -> {
            go.countDown();
            go.await();
            return table.registry.prepareDeployment("d1");
        });
        return new Race(played.get(), prepared.get());
    }

    // 경합이 정확히 한쪽의 승리로 끝났는지 확인한다
    private static void assertOneWinner(Table table, Race race, String refusal) {
        if (race.code().equals("OK")) {
            assertThat(race.prepared().ready()).as("a game went live under a READY").isFalse();
            assertThat(race.prepared().activeTournaments()).isEqualTo(1);
            assertThat(table.gate.isClosed()).isFalse();
            assertThat(table.phase()).isEqualTo(RoomPhase.PLAYING);
        } else {
            assertThat(race.code()).isIn(refusal, "STALE_STATE");
            assertThat(race.prepared().ready()).isTrue();
            assertThat(table.gate.isClosed()).isTrue();
            assertThat(table.phase()).isNotEqualTo(RoomPhase.PLAYING);
        }
    }

    // 시작과 준비를 100회 겹쳐도 시작 성공과 READY가 함께 나오지 않는지 확인한다
    @Test
    void startAndPrepareNeverBothSucceed() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < ROUNDS; round++) {
                Table table = new Table();
                table.addIdleRooms();

                Race race = race(pool, table, () -> table.hostCommand("START", "{}", false));

                assertOneWinner(table, race, "DEPLOY_PENDING");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // 결과 화면 UNDO와 준비를 100회 겹쳐도 되살린 게임과 READY가 함께 나오지 않는지 확인한다
    @Test
    void undoOnTheResultScreenAndPrepareNeverBothSucceed() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < ROUNDS; round++) {
                Table table = new Table();
                table.addIdleRooms();
                table.finishGame();

                Race race = race(pool, table, () -> table.hostCommand("UNDO", "{}", false));

                assertOneWinner(table, race, "UNDO_DEPLOY_PENDING");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // 방 잠금을 잡은 채 준비를 시작시켜 게이트가 방 확인보다 먼저 닫히는지 기다린다
    private static Future<PrepareResult> prepareBehindTheRoomLock(ExecutorService pool, Table table) throws Exception {
        Future<PrepareResult> prepared = pool.submit(() -> table.registry.prepareDeployment("d1"));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!table.gate.isClosed()) {
            assertThat(System.nanoTime()).as("the gate must close before any room is checked").isLessThan(deadline);
            Thread.onSpinWait();
        }
        return prepared;
    }

    // 게이트가 닫힌 뒤 방 잠금을 얻은 START는 거절되고 준비는 READY인지 확인한다
    @Test
    void aStartThatGetsTheRoomLockAfterTheCloseIsRefused() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Table table = new Table();
            Room room = table.registry.withRoom(table.roomId, r -> r);
            Future<PrepareResult> prepared;
            String code;
            room.lock().lock();
            try {
                prepared = prepareBehindTheRoomLock(pool, table);
                // Straight to the pipeline: update would wait for the global lock while holding this room's lock.
                code = table.startHoldingTheRoomLock(room);
            } finally {
                room.lock().unlock();
            }

            assertThat(code).isEqualTo("DEPLOY_PENDING");
            assertThat(prepared.get(5, TimeUnit.SECONDS).ready()).isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    // 게이트가 닫히기 전에 방 잠금 안에서 시작된 게임은 준비가 HELD로 보는지 확인한다
    @Test
    void aStartThatHoldsTheRoomLockAcrossTheCloseIsSeenByTheCheck() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Table table = new Table();
            Room room = table.registry.withRoom(table.roomId, r -> r);
            Future<PrepareResult> prepared;
            room.lock().lock();
            try {
                assertThat(table.hostCommand("START", "{}", false)).isEqualTo("OK");
                prepared = prepareBehindTheRoomLock(pool, table);
            } finally {
                room.lock().unlock();
            }

            PrepareResult result = prepared.get(5, TimeUnit.SECONDS);
            assertThat(result.ready()).isFalse();
            assertThat(result.activeTournaments()).isEqualTo(1);
            assertThat(table.gate.isClosed()).isFalse();
        } finally {
            pool.shutdownNow();
        }
    }

    // 준비와 해제가 대기방 구독자에게 새 버전의 스냅샷으로 알려지는지 확인한다
    @Test
    void closingAndOpeningPublishASnapshotToWaitingRooms() {
        Table table = new Table();
        long version = table.version();

        assertThat(table.registry.prepareDeployment("d1").ready()).isTrue();

        assertThat(table.version()).isEqualTo(version + 1);
        assertThat(table.lastPublishedDeployPending()).isTrue();

        assertThat(table.registry.releaseDeployment("d1")).isTrue();

        assertThat(table.version()).isEqualTo(version + 2);
        assertThat(table.lastPublishedDeployPending()).isFalse();
    }

    // 같은 배포의 재시도가 버전을 다시 올리지 않는지 확인한다
    @Test
    void aRepeatedPrepareDoesNotBumpAgain() {
        Table table = new Table();
        table.registry.prepareDeployment("d1");
        long version = table.version();

        table.registry.prepareDeployment("d1");

        assertThat(table.version()).isEqualTo(version);
    }

    // 닫힌 동안 만든 방이 처음부터 안내를 켜는지 확인한다
    @Test
    void aRoomCreatedWhileClosedShowsThePendingDeployment() {
        Table table = new Table();
        table.registry.prepareDeployment("d1");

        Entry late = table.registry.create("Late");

        boolean pending = table.registry.withRoom(late.roomId(), room -> room.deployPending());
        assertThat(pending).isTrue();
    }

    // 해제 알림이 닿기 전에 시작된 방에도 안내가 남지 않는지 확인한다
    @Test
    void aGameStartedBeforeTheReleaseAnnouncementLosesTheNotice() {
        Table table = new Table();
        table.registry.prepareDeployment("d1");
        table.gate.open("d1");
        assertThat(table.hostCommand("START", "{}", false)).isEqualTo("OK");
        assertThat(table.phase()).isEqualTo(RoomPhase.PLAYING);

        table.registry.releaseDeployment("d1");

        assertThat(table.deployPending()).isFalse();
    }

    // 다른 배포가 닫아 둔 동안의 준비가 거절되고 게이트를 바꾸지 않는지 확인한다
    @Test
    void anotherDeploymentIsRefusedWithoutTouchingTheGate() {
        Table table = new Table();
        table.gate.close("d1");

        assertThatThrownBy(() -> table.registry.prepareDeployment("d2")).isInstanceOf(RoomException.class)
                .extracting(e -> ((RoomException) e).code()).isEqualTo("DEPLOY_IN_PROGRESS");

        assertThat(table.gate.deploymentId()).contains("d1");
    }

    // 알림이 공용 잠금 밖에서 나가는지 다른 스레드의 공용 잠금 획득으로 확인한다
    @Test
    void theAnnouncementIsPublishedOutsideTheGlobalLock() throws Exception {
        ExecutorService probe = Executors.newSingleThreadExecutor();
        try {
            List<RoomRegistry> self = new ArrayList<>();
            List<Long> reachable = new ArrayList<>();
            Table table = new Table(publication -> {
                if (!publication.deliveries().isEmpty() && !self.isEmpty()) {
                    try {
                        reachable.add(probe.submit(() -> self.getFirst().roomIds().stream().count())
                                .get(5, TimeUnit.SECONDS));
                    } catch (Exception e) {
                        throw new IllegalStateException("the publisher ran under the global lock", e);
                    }
                }
            });
            self.add(table.registry);

            table.registry.prepareDeployment("d1");

            assertThat(reachable).containsExactly(1L);
        } finally {
            probe.shutdownNow();
        }
    }
}
