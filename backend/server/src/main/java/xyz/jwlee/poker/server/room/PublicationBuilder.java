package xyz.jwlee.poker.server.room;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.game.event.GameEvent;

// 지난 수집 뒤의 방 변경을 수신자별 메시지와 끊을 연결 목록으로 만든다
/**
 * The caller holds the room lock. A subscriber gets one SNAPSHOT when the state version or the draft version
 * moved since the last collection, in their own view. A connection that asked for a snapshot gets exactly one
 * message without history, whatever else changed: it has not seen the previous version, so a delta means nothing
 * to it. A closed room sends no SNAPSHOT, its remaining connections go to {@code goneConnections}.
 */
public final class PublicationBuilder {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private PublicationBuilder() {}

    // 쌓인 변경을 메시지로 만들고 수집 위치를 현재로 옮긴다
    public static Publication collect(Room room) {
        List<String> revoked = room.drainPendingRevocations();
        Set<String> requested = room.drainSnapshotRequests();
        List<Publication.Delivery> deliveries = new ArrayList<>();
        List<String> gone = new ArrayList<>();
        if (room.isClosed()) {
            gone.addAll(room.presence().subscribers().keySet());
        } else {
            boolean changed = room.changedSinceCollect();
            ArrayNode events = changed ? eventsSinceCollect(room) : F.arrayNode();
            room.presence().subscribers().forEach((connectionId, participantId) -> {
                boolean asked = requested.contains(connectionId);
                if (changed || asked) {
                    room.participant(participantId).ifPresent(viewer -> deliveries.add(new Publication.Delivery(
                            connectionId, asked ? fresh(room, viewer) : delta(room, viewer, events))));
                }
            });
        }
        room.markCollected();
        return new Publication(List.copyOf(deliveries), revoked, List.copyOf(gone));
    }

    // 지난 수집 뒤 쌓인 이벤트에 기록 조회와 같은 번호를 붙인다
    private static ArrayNode eventsSinceCollect(Room room) {
        ArrayNode out = F.arrayNode();
        List<GameEvent> all = room.events();
        for (int index = room.collectedEventCount(); index < all.size(); index++) {
            out.add(EventView.write(all.get(index), index + 1L));
        }
        return out;
    }

    // 이전 버전과 새 이벤트를 담은 변경 메시지를 만든다
    private static ObjectNode delta(Room room, Participant viewer, ArrayNode events) {
        ObjectNode message = header();
        message.put("previousVersion", room.collectedVersion());
        message.set("events", events);
        message.set("state", SnapshotWriter.snapshot(room, viewer).json());
        return message;
    }

    // 이전 버전 없이 현재 상태만 담은 메시지를 만든다
    private static ObjectNode fresh(Room room, Participant viewer) {
        ObjectNode message = header();
        message.putNull("previousVersion");
        message.set("events", F.arrayNode());
        message.set("state", SnapshotWriter.snapshot(room, viewer).json());
        return message;
    }

    // 메시지 종류만 적힌 객체를 만든다
    private static ObjectNode header() {
        return F.objectNode().put("type", "SNAPSHOT");
    }
}
