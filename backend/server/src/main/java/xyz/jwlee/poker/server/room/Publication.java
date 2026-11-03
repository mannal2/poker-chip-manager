package xyz.jwlee.poker.server.room;

import java.util.List;
import tools.jackson.databind.node.ObjectNode;

// 방 변경 한 번으로 연결들에 보낼 메시지와 끊어야 할 연결을 담는다
/** Built under the room lock and handed over after it is released; nothing here refers to the live room. */
public record Publication(List<Delivery> deliveries, List<String> revokedConnections, List<String> goneConnections) {

    // 연결 하나에 보낼 메시지
    public record Delivery(String connectionId, ObjectNode message) { }

    // 보낼 메시지도 끊을 연결도 없는지 확인한다
    public boolean isEmpty() {
        return deliveries.isEmpty() && revokedConnections.isEmpty() && goneConnections.isEmpty();
    }
}
