package xyz.jwlee.poker.server.realtime;

import java.util.List;
import java.util.Map;
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

    // 연결을 등록하고 서버 전체 한도를 넘으면 false를 돌려준다
    synchronized boolean register(Connection connection) {
        if (connections.size() >= MAX_CONNECTIONS) {
            return false;
        }
        connections.put(connection.connectionId(), connection);
        return true;
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
