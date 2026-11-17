package xyz.jwlee.poker.server.realtime;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.server.room.Publication;
import xyz.jwlee.poker.server.room.RoomPublisher;

// 열린 연결의 목록을 관리하고 방 변경을 연결의 대기열에 넣는다
/**
 * {@link #publish} can run inside {@code synchronized (ledger)}, so it only enqueues. A delivery for a connection
 * that is gone or was already sent a final message is dropped. The hub needs no registry (the registry needs the
 * hub): what a closing connection does to its room is {@code RoomSocketHandler}'s job.
 */
@Component
public final class ConnectionHub implements RoomPublisher {

    private static final int MAX_CONNECTIONS = 500;
    private static final int MAX_CONNECTIONS_PER_SESSION = 8;

    private final Map<String, Connection> connections = new ConcurrentHashMap<>();

    // 종류만 있는 서버 메시지를 만든다
    static ObjectNode control(String type) {
        return JsonNodeFactory.instance.objectNode().put("type", type);
    }

    // 변경을 각 연결의 대기열에 넣고 바로 돌아온다
    @Override
    public void publish(Publication publication) {
        for (Publication.Delivery delivery : publication.deliveries()) {
            Connection connection = connections.get(delivery.connectionId());
            if (connection != null) {
                connection.offerSnapshot(delivery.message());
            }
        }
        offerFinal(publication.revokedConnections(), "ACCESS_REVOKED");
        offerFinal(publication.goneConnections(), "ROOM_GONE");
    }

    // 주어진 연결들에 마지막 메시지를 넣는다
    private void offerFinal(List<String> connectionIds, String type) {
        for (String connectionId : connectionIds) {
            Connection connection = connections.get(connectionId);
            if (connection != null) {
                connection.offerFinal(control(type));
            }
        }
    }

    // 연결을 등록한다. 서버 전체 한도면 false, 세션 한도면 그 세션에서 가장 오래 응답 없는 연결을 밀어낸다
    /**
     * A socket iOS froze without a close frame still counts until the heartbeat ends it, so at the session limit the
     * newest socket is the one most likely alive: the stalest one is closed with {@link Connection#CLOSE_REPLACED}
     * instead. The server-wide limit still refuses, because it would cost somebody else their connection.
     */
    synchronized boolean register(Connection connection) {
        if (connections.size() >= MAX_CONNECTIONS) {
            return false;
        }
        List<Connection> sameSession = connections.values().stream()
                .filter(other -> other.sessionId().equals(connection.sessionId())).toList();
        if (sameSession.size() >= MAX_CONNECTIONS_PER_SESSION) {
            stalest(sameSession).ifPresent(victim -> {
                connections.remove(victim.connectionId(), victim);
                victim.close(Connection.CLOSE_REPLACED);
            });
        }
        connections.put(connection.connectionId(), connection);
        return true;
    }

    // 닫히지 않은 후보 중 마지막 응답이 가장 오래된 연결을 고르고, 같으면 먼저 열린 연결을 고른다
    static Optional<Connection> stalest(Collection<Connection> candidates) {
        return candidates.stream().filter(c -> !c.isClosed())
                .min(Comparator.comparing(Connection::lastPong).thenComparingLong(Connection::serial));
    }

    // 연결 식별자로 열린 연결을 찾는다
    Optional<Connection> find(String connectionId) {
        return Optional.ofNullable(connections.get(connectionId));
    }

    // 연결을 목록에서 뺀다
    void unregister(Connection connection) {
        connections.remove(connection.connectionId(), connection);
    }

    // 열린 연결의 복사본을 돌려준다
    List<Connection> connections() {
        return List.copyOf(connections.values());
    }

    // 세션의 모든 연결에 접근 회수를 보내 닫는다
    void revokeSession(String sessionId) {
        for (Connection connection : connections.values()) {
            if (connection.sessionId().equals(sessionId)) {
                connection.offerFinal(control("ACCESS_REVOKED"));
            }
        }
    }
}
