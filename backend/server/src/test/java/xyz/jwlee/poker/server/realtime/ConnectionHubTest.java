package xyz.jwlee.poker.server.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import xyz.jwlee.poker.server.room.MutableClock;

// 연결 목록의 한도와 오래된 연결 밀어내기를 검사한다
class ConnectionHubTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-11-17T00:00:00Z"));
    private final ConnectionHub hub = new ConnectionHub();
    private final List<Connection> opened = new ArrayList<>();
    private final List<FakeSocket> sockets = new ArrayList<>();

    // 테스트가 연 연결을 모두 닫는다
    @AfterEach
    void closeAll() {
        opened.forEach(Connection::close);
    }

    // 세션의 연결 하나를 열고 등록 결과와 함께 돌려준다
    private Connection open(String sessionId) {
        FakeSocket socket = new FakeSocket();
        Connection connection = Connection.open("c" + opened.size(), sessionId, socket, clock, hub::unregister);
        opened.add(connection);
        sockets.add(socket);
        return connection;
    }

    // 연결이 방금 PONG에 답한 것으로 만든다
    private void answer(Connection connection) {
        connection.ping("n", 1L);
        connection.pong("n");
    }

    // 세션의 아홉 번째 연결은 받아들이고 가장 오래 응답 없는 연결을 4001로 닫는다
    @Test
    void evictsTheConnectionSilentTheLongest() throws Exception {
        List<Connection> eight = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            clock.advance(Duration.ofSeconds(1));
            Connection c = open("s");
            assertThat(hub.register(c)).isTrue();
            eight.add(c);
        }
        clock.advance(Duration.ofSeconds(10));
        for (int i = 0; i < 8; i++) {
            if (i != 2) {
                answer(eight.get(i));
            }
        }

        assertThat(hub.register(open("s"))).isTrue();

        assertThat(sockets.get(2).awaitClosed()).isEqualTo(Connection.CLOSE_REPLACED);
        assertThat(hub.connections()).hasSize(8).doesNotContain(eight.get(2));
    }

    // 응답 시각이 같으면 먼저 열린 연결을 밀어낸다
    @Test
    void breaksTiesByOpeningOrder() throws Exception {
        for (int i = 0; i < 8; i++) {
            assertThat(hub.register(open("s"))).isTrue();
        }

        assertThat(hub.register(open("s"))).isTrue();

        assertThat(sockets.getFirst().awaitClosed()).isEqualTo(Connection.CLOSE_REPLACED);
        assertThat(hub.connections()).hasSize(8).doesNotContain(opened.getFirst());
    }

    // 다른 세션의 연결은 밀어내지 않는다
    @Test
    void evictsOnlyFromTheSameSession() throws Exception {
        Connection other = open("other");
        assertThat(hub.register(other)).isTrue();
        clock.advance(Duration.ofSeconds(5));
        for (int i = 0; i < 8; i++) {
            Connection c = open("s");
            assertThat(hub.register(c)).isTrue();
            answer(c);
        }

        assertThat(hub.register(open("s"))).isTrue();

        assertThat(other.isClosed()).isFalse();
        assertThat(hub.connections()).contains(other).hasSize(9);
    }

    // 서버 전체 한도는 지금처럼 새 연결을 거절한다
    @Test
    void stillRefusesNewConnectionsAtTheServerLimit() {
        for (int i = 0; i < 500; i++) {
            assertThat(hub.register(open("s" + i))).isTrue();
        }

        assertThat(hub.register(open("s0"))).isFalse();
        assertThat(opened.getFirst().isClosed()).isFalse();
    }
}
