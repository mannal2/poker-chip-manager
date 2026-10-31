package xyz.jwlee.poker.server.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.node.JsonNodeFactory;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.MutableClock;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomPublisher;
import xyz.jwlee.poker.server.support.IdGenerator;

// 시계를 직접 진행시켜 생존 확인 시간 규칙을 검사한다
class HeartbeatTaskTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-31T00:00:00Z"));
    private final AtomicLong nonces = new AtomicLong();
    private final IdGenerator ids = IdGenerator.random();
    private final RoomRegistry registry = new RoomRegistry(ids, clock, new RoomPublisher.Silent());
    private final ConnectionHub hub = new ConnectionHub();
    private final HeartbeatTask task = new HeartbeatTask(hub, registry, clock, () -> "n" + nonces.incrementAndGet());
    private final FakeSocket socket = new FakeSocket();
    private final String roomId = registry.create("Host").roomId();
    private final Connection connection = Connection.open("c1", "s1", socket, clock, hub::unregister);

    {
        hub.register(connection);
        connection.subscribeTo(roomId);
    }

    // 막힌 전송을 풀어 가상 스레드를 끝낸다
    @AfterEach
    void releaseSocket() {
        socket.release();
        connection.close();
    }

    // 시계를 진행시킨 뒤 점검을 한 번 실행한다
    private void after(Duration by) {
        clock.advance(by);
        task.tick();
    }

    private long stateVersion() {
        return registry.withRoom(roomId, Room::version);
    }

    @Test
    void aPingGoesOutEveryFifteenSecondsWithTheCurrentStateVersion() throws Exception {
        after(Duration.ofMillis(14_900));
        assertThat(socket.sent).isEmpty();

        after(Duration.ofMillis(100));
        socket.awaitSendStarted();

        await().until(() -> socket.sent.size() == 1);
        assertThat(socket.message(0).get("type").asString()).isEqualTo("PING");
        assertThat(socket.message(0).get("nonce").asString()).isEqualTo("n1");
        assertThat(socket.message(0).get("stateVersion").asLong()).isEqualTo(stateVersion());

        registry.update(roomId, Room::bumpVersion);
        after(Duration.ofSeconds(1));
        assertThat(socket.sent).hasSize(1);
        after(Duration.ofSeconds(14));
        socket.awaitSendStarted();
        await().until(() -> socket.sent.size() == 2);
        assertThat(socket.message(1).get("stateVersion").asLong()).isEqualTo(stateVersion());
    }

    @Test
    void anUnsubscribedConnectionIsPingedWithoutAVersion() throws Exception {
        FakeSocket fresh = new FakeSocket();
        Connection unsubscribed = Connection.open("c2", "s2", fresh, clock, hub::unregister);
        hub.register(unsubscribed);

        after(Duration.ofSeconds(15));
        fresh.awaitSendStarted();

        await().until(() -> fresh.sent.size() == 1);
        assertThat(fresh.message(0).get("stateVersion").isNull()).isTrue();
        unsubscribed.close();
    }

    @Test
    void aSilentConnectionLastsUntilFortyFiveSeconds() throws Exception {
        after(Duration.ofMillis(44_900));
        assertThat(socket.closedWith).isNotDone();

        after(Duration.ofMillis(100));
        socket.awaitClosed();
    }

    @Test
    void aPongExtendsTheDeadlineButNotTheStateVersion() throws Exception {
        long before = stateVersion();
        after(Duration.ofSeconds(15));
        socket.awaitSendStarted();
        await().until(() -> socket.sent.size() == 1);

        clock.advance(Duration.ofSeconds(25));
        connection.pong("n1");

        after(Duration.ofMillis(44_900));
        assertThat(socket.closedWith).isNotDone();
        assertThat(stateVersion()).isEqualTo(before);

        after(Duration.ofMillis(100));
        socket.awaitClosed();
    }

    @Test
    void aPongWithAnotherNonceDoesNotExtendTheDeadline() throws Exception {
        after(Duration.ofSeconds(15));
        clock.advance(Duration.ofSeconds(25));
        connection.pong("forged");
        connection.pong(null);

        after(Duration.ofSeconds(5));

        socket.awaitClosed();
    }

    @Test
    void aSendStalledForTenSecondsIsClosed() throws Exception {
        socket.block();
        connection.offerSnapshot(JsonNodeFactory.instance.objectNode().put("type", "SNAPSHOT"));
        socket.awaitSendStarted();

        after(Duration.ofMillis(9_900));
        assertThat(socket.closedWith).isNotDone();

        after(Duration.ofMillis(100));
        socket.awaitClosed();
    }

    @Test
    void aSweepOfManyConnectionsSurvivesOneRoomBeingGone() throws Exception {
        registry.remove(roomId);

        after(Duration.ofSeconds(15));
        socket.awaitSendStarted();

        await().until(() -> socket.sent.size() == 1);
        assertThat(socket.message(0).get("stateVersion").isNull()).isTrue();
    }
}
