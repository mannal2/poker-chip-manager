package xyz.jwlee.poker.server.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.server.room.MutableClock;
import xyz.jwlee.poker.server.room.Publication;

// 연결마다의 전송 대기열과 허브의 비차단 배달을 검사한다
class ConnectionTest {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final int MAX_MESSAGE_BYTES = 256 * 1024;

    private final Clock clock = new MutableClock(Instant.parse("2026-10-31T00:00:00Z"));
    private final FakeSocket socket = new FakeSocket();
    private final AtomicInteger closedCalls = new AtomicInteger();
    private final List<FakeSocket> opened = new ArrayList<>();
    private final Connection connection = Connection.open("c1", "s1", socket, clock, c -> closedCalls.incrementAndGet());

    // 막힌 채 남은 전송을 풀어 가상 스레드를 끝낸다
    @AfterEach
    void releaseSockets() {
        socket.release();
        opened.forEach(FakeSocket::release);
    }

    // 상태·초안 버전을 담은 SNAPSHOT 메시지를 만든다
    private static ObjectNode snapshot(long stateVersion, long draftVersion) {
        ObjectNode message = F.objectNode().put("type", "SNAPSHOT");
        message.putObject("state").put("stateVersion", stateVersion).put("draftVersion", draftVersion);
        return message;
    }

    // 종류만 있는 메시지를 만든다
    private static ObjectNode control(String type) {
        return F.objectNode().put("type", type);
    }

    // 스냅샷 메시지의 상태 버전을 읽는다
    private long versionOf(FakeSocket from, int index) {
        return from.message(index).get("state").get("stateVersion").asLong();
    }

    // 첫 스냅샷을 전송 중인 채로 막아 둔다
    private void blockOnFirstSnapshot() throws Exception {
        socket.block();
        connection.offerSnapshot(snapshot(1, 0));
        socket.awaitSendStarted();
    }

    // 허브에 등록한 새 연결과 소켓을 만든다
    private Connection connected(ConnectionHub hub, String id, String sessionId, FakeSocket target) {
        Connection c = Connection.open(id, sessionId, target, clock, hub::unregister);
        opened.add(target);
        assertThat(hub.register(c)).isTrue();
        return c;
    }

    // 전송이 막힌 동안에는 가장 최근 스냅샷만 대기하는지 확인한다
    @Test
    void whileASendIsBlockedOnlyTheLatestSnapshotWaits() throws Exception {
        blockOnFirstSnapshot();

        for (long v = 2; v <= 101; v++) {
            connection.offerSnapshot(snapshot(v, 0));
        }
        socket.release();
        socket.awaitSendStarted();
        connection.offerSnapshot(snapshot(102, 0));
        socket.awaitSendStarted();

        await().atMost(Duration.ofSeconds(5)).until(() -> socket.sent.size() == 3);
        assertThat(versionOf(socket, 0)).isEqualTo(1);
        assertThat(versionOf(socket, 1)).isEqualTo(101);
        assertThat(versionOf(socket, 2)).isEqualTo(102);
    }

    // 전송 시작 시각이 전송 중에만 존재하는지 확인한다
    @Test
    void sendingSinceIsPresentOnlyDuringASend() throws Exception {
        assertThat(connection.sendingSince()).isEmpty();

        blockOnFirstSnapshot();
        assertThat(connection.sendingSince()).contains(clock.instant());

        socket.release();
        await().atMost(Duration.ofSeconds(5)).until(() -> connection.sendingSince().isEmpty());
    }

    // 늦게 온 낮은 버전 스냅샷이 높은 버전을 대체하지 않는지 확인한다
    @Test
    void aLateLowerSnapshotNeverReplacesAHigherOne() throws Exception {
        blockOnFirstSnapshot();

        connection.offerSnapshot(snapshot(5, 2));
        connection.offerSnapshot(snapshot(4, 9));
        connection.offerSnapshot(snapshot(5, 1));
        socket.release();
        socket.awaitSendStarted();

        await().atMost(Duration.ofSeconds(5)).until(() -> socket.sent.size() == 2);
        assertThat(versionOf(socket, 1)).isEqualTo(5);
        assertThat(socket.message(1).get("state").get("draftVersion").asLong()).isEqualTo(2);
    }

    // 높은 버전을 보낸 뒤 늦게 온 낮은 버전은 버려지는지 확인한다
    @Test
    void aLateLowerSnapshotIsDroppedAfterTheHigherOneWasSent() throws Exception {
        connection.offerSnapshot(snapshot(5, 0));
        socket.awaitSendStarted();

        connection.offerSnapshot(snapshot(4, 0));
        connection.offerSnapshot(snapshot(6, 0));
        socket.awaitSendStarted();

        await().atMost(Duration.ofSeconds(5)).until(() -> socket.sent.size() == 2);
        assertThat(versionOf(socket, 1)).isEqualTo(6);
    }

    // 더 높은 초안 버전은 대체하고 같은 버전은 그대로 전달되는지 확인한다
    @Test
    void aHigherDraftVersionReplacesAndTheSameVersionIsStillDelivered() throws Exception {
        connection.offerSnapshot(snapshot(5, 1));
        socket.awaitSendStarted();

        connection.offerSnapshot(snapshot(5, 2));
        socket.awaitSendStarted();
        connection.offerSnapshot(snapshot(5, 2));
        socket.awaitSendStarted();

        await().atMost(Duration.ofSeconds(5)).until(() -> socket.sent.size() == 3);
    }

    // 마지막 메시지는 대체되지 않고 연결을 끝내는지 확인한다
    @Test
    void aFinalMessageIsNotReplacedAndEndsTheConnection() throws Exception {
        blockOnFirstSnapshot();

        connection.offerSnapshot(snapshot(2, 0));
        connection.offerFinal(control("ACCESS_REVOKED"));
        connection.offerFinal(control("ROOM_GONE"));
        connection.offerSnapshot(snapshot(3, 0));
        socket.release();

        assertThat(socket.awaitClosed()).isEqualTo(1000);
        assertThat(socket.sent).hasSize(2);
        assertThat(socket.message(1).get("type").asString()).isEqualTo("ACCESS_REVOKED");
        await().atMost(Duration.ofSeconds(5)).until(() -> closedCalls.get() == 1);
    }

    // 한도를 넘는 메시지는 보내지 않고 연결을 닫는지 확인한다
    @Test
    void aMessageOverTheLimitIsNotSentAndClosesTheConnection() throws Exception {
        ObjectNode big = snapshot(1, 0);
        big.put("padding", "가".repeat(MAX_MESSAGE_BYTES / 3 + 1));

        connection.offerSnapshot(big);

        assertThat(socket.awaitClosed()).isEqualTo(1009);
        assertThat(socket.sent).isEmpty();
        await().atMost(Duration.ofSeconds(5)).until(() -> closedCalls.get() == 1);
    }

    // 한도에 딱 맞는 메시지는 보내지는지 확인한다
    @Test
    void aMessageExactlyAtTheLimitIsSent() throws Exception {
        ObjectNode exact = snapshot(1, 0);
        exact.put("padding", "");
        int overhead = exact.toString().length();
        exact.put("padding", "x".repeat(MAX_MESSAGE_BYTES - overhead));

        connection.offerSnapshot(exact);
        socket.awaitSendStarted();

        await().atMost(Duration.ofSeconds(5)).until(() -> socket.sent.size() == 1);
        assertThat(socket.closedWith).isNotDone();
    }

    // 전송이 실패하면 연결을 닫는지 확인한다
    @Test
    void aFailedSendClosesTheConnection() throws Exception {
        socket.failSends();

        connection.offerSnapshot(snapshot(1, 0));

        assertThat(socket.awaitClosed()).isEqualTo(1001);
        await().atMost(Duration.ofSeconds(5)).until(() -> closedCalls.get() == 1);
    }

    // 전송이 막혀 있어도 닫기가 즉시 반환되는지 확인한다
    @Test
    @Timeout(value = 5, unit = TimeUnit.SECONDS)
    void closingReturnsAtOnceEvenWhileASendIsBlocked() throws Exception {
        blockOnFirstSnapshot();

        connection.close();
        connection.close();

        assertThat(socket.awaitClosed()).isEqualTo(1001);
        await().atMost(Duration.ofSeconds(5)).until(() -> closedCalls.get() == 1);
        connection.offerSnapshot(snapshot(2, 0));
        socket.release();
        await().atMost(Duration.ofSeconds(5)).until(() -> socket.sent.size() == 1);
        assertThat(closedCalls).hasValue(1);
    }

    // 막힌 연결이 발행이나 다른 연결을 붙잡지 않는지 확인한다
    @Test
    @Timeout(value = 5, unit = TimeUnit.SECONDS)
    void aBlockedConnectionDoesNotHoldUpPublishOrTheOthers() throws Exception {
        ConnectionHub hub = new ConnectionHub();
        FakeSocket stuck = new FakeSocket();
        FakeSocket healthy = new FakeSocket();
        connected(hub, "stuck", "s1", stuck);
        connected(hub, "healthy", "s2", healthy);
        stuck.block();
        hub.publish(new Publication(List.of(new Publication.Delivery("stuck", snapshot(1, 0))), List.of(), List.of()));
        stuck.awaitSendStarted();

        hub.publish(new Publication(List.of(
                new Publication.Delivery("stuck", snapshot(2, 0)),
                new Publication.Delivery("healthy", snapshot(2, 0))), List.of("stuck"), List.of()));

        healthy.awaitSendStarted();
        await().atMost(Duration.ofSeconds(4)).until(() -> healthy.sent.size() == 1);
    }

    // 허브가 마지막 메시지는 전달하고 나머지는 버리는지 확인한다
    @Test
    void theHubDeliversFinalMessagesAndDropsTheRest() throws Exception {
        ConnectionHub hub = new ConnectionHub();
        FakeSocket kicked = new FakeSocket();
        FakeSocket left = new FakeSocket();
        connected(hub, "kicked", "s1", kicked);
        connected(hub, "left", "s2", left);

        hub.publish(new Publication(List.of(new Publication.Delivery("nobody", snapshot(1, 0))),
                List.of("kicked", "nobody"), List.of("left", "nobody")));
        hub.publish(new Publication(List.of(new Publication.Delivery("kicked", snapshot(2, 0))), List.of(), List.of()));

        assertThat(kicked.awaitClosed()).isEqualTo(1000);
        assertThat(left.awaitClosed()).isEqualTo(1000);
        assertThat(kicked.sent).hasSize(1);
        assertThat(kicked.message(0).get("type").asString()).isEqualTo("ACCESS_REVOKED");
        assertThat(left.message(0).get("type").asString()).isEqualTo("ROOM_GONE");
        await().atMost(Duration.ofSeconds(5)).until(() -> hub.connections().isEmpty());
    }

    // 세션을 폐기하면 그 세션의 연결만 끝나는지 확인한다
    @Test
    void revokingASessionEndsOnlyItsConnections() throws Exception {
        ConnectionHub hub = new ConnectionHub();
        FakeSocket mine = new FakeSocket();
        FakeSocket other = new FakeSocket();
        connected(hub, "mine", "expired", mine);
        connected(hub, "other", "alive", other);

        hub.revokeSession("expired");

        assertThat(mine.awaitClosed()).isEqualTo(1000);
        assertThat(mine.message(0).get("type").asString()).isEqualTo("ACCESS_REVOKED");
        assertThat(other.closedWith).isNotDone();
    }

    // 서버 전체 한도를 넘는 연결을 허브가 거부하는지 확인한다
    @Test
    void theHubRefusesTheConnectionOverTheServerLimit() {
        ConnectionHub hub = new ConnectionHub();
        List<Connection> all = new ArrayList<>();
        for (int i = 0; i < 500; i++) {
            all.add(connected(hub, "c" + i, "s" + i, new FakeSocket()));
        }

        Connection extra = Connection.open("extra", "s", new FakeSocket(), clock, c -> { });
        assertThat(hub.register(extra)).isFalse();

        hub.unregister(extra);
        assertThat(hub.connections()).hasSize(500);
        hub.unregister(all.getFirst());
        assertThat(hub.register(extra)).isTrue();
        extra.close();
        all.forEach(Connection::close);
    }

    // 연결이 닫힘 콜백 이전에 이미 닫히는 중임을 아는지 확인한다
    @Test
    void aConnectionKnowsItIsClosingBeforeItsCallbackRuns() {
        CompletableFuture<Boolean> seen = new CompletableFuture<>();
        Connection c = Connection.open("c", "s", new FakeSocket(), clock, closed -> seen.complete(closed.isClosed()));

        c.close();

        assertThat(seen).succeedsWithin(Duration.ofSeconds(5)).isEqualTo(true);
    }

    // 한 세션의 아홉 번째 연결은 거부하되 다른 세션은 허용하는지 확인한다
    @Test
    void theHubRefusesTheNinthConnectionOfASessionButNotAnotherSession() {
        ConnectionHub hub = new ConnectionHub();
        List<Connection> all = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            all.add(connected(hub, "c" + i, "busy", new FakeSocket()));
        }

        Connection ninth = Connection.open("ninth", "busy", new FakeSocket(), clock, c -> { });
        assertThat(hub.register(ninth)).isFalse();
        assertThat(hub.connections()).hasSize(8);
        all.add(connected(hub, "other", "calm", new FakeSocket()));

        hub.unregister(all.getFirst());
        assertThat(hub.register(ninth)).isTrue();
        ninth.close();
        all.forEach(Connection::close);
    }
}
