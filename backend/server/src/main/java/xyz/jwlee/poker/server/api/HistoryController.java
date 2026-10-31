package xyz.jwlee.poker.server.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.server.auth.SessionIdentity;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.EventView;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomException;

// 방의 현재 토너먼트 이벤트 기록을 페이지 단위로 제공하는 컨트롤러
/**
 * The room's event history for the current tournament, a page at a time. Events are numbered from 1 in the
 * order they happened; {@code after} is the last number the caller already has. An undone event stays in the
 * list (the UNDO event that follows it says so), the screen hides undone rows itself.
 */
@RestController
class HistoryController {

    static final int DEFAULT_LIMIT = 50;
    static final int MAX_LIMIT = 100;

    private final RoomRegistry registry;

    HistoryController(RoomRegistry registry) {
        this.registry = registry;
    }

    // 참가자 확인 후 지정 번호 이후의 이벤트 한 페이지를 응답한다
    @GetMapping("/api/rooms/{roomId}/history")
    ResponseEntity<?> history(
            @PathVariable String roomId,
            @RequestParam String tournamentId,
            @RequestParam(defaultValue = "0") long after,
            @RequestParam(defaultValue = "" + DEFAULT_LIMIT) int limit,
            HttpServletRequest request) {
        if (after < 0 || limit < 1) {
            throw new RoomException("INVALID_INPUT");
        }
        int page = Math.min(limit, MAX_LIMIT);
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new RoomException("NO_SESSION");
        }
        String participantId = SessionIdentity.from(session).participantIn(roomId)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        return registry.withRoom(roomId, room -> {
            if (!room.hasParticipant(participantId)) {
                throw new RoomException("ROOM_NOT_FOUND");
            }
            if (room.game() == null || !room.game().tournamentId.equals(tournamentId)) {
                return ResponseEntity.status(410).header(HttpHeaders.CACHE_CONTROL, "no-store")
                        .body(ApiError.of("TOURNAMENT_CHANGED"));
            }
            return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(page(room, after, page));
        });
    }

    // 번호가 붙은 이벤트를 최대 개수까지 모아 다음 조회 기준과 함께 만든다
    private static ObjectNode page(Room room, long after, int limit) {
        List<GameEvent> all = room.events();
        ObjectNode out = JsonNodeFactory.instance.objectNode();
        ArrayNode events = out.putArray("events");
        long last = after;
        // Sequence n is index n - 1; an after beyond the end simply returns nothing.
        for (long seq = after + 1; seq <= all.size() && events.size() < limit; seq++) {
            events.add(EventView.write(all.get((int) seq - 1), seq));
            last = seq;
        }
        out.put("nextAfter", last);
        return out;
    }
}
