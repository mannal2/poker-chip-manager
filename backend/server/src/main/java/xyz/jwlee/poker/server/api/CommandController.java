package xyz.jwlee.poker.server.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.Optional;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.server.auth.SessionIdentity;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.CommandPipeline;
import xyz.jwlee.poker.server.room.CommandRequest;
import xyz.jwlee.poker.server.room.CommandResult;
import xyz.jwlee.poker.server.room.Participant;
import xyz.jwlee.poker.server.room.RequestOutcome;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.SnapshotWriter;
import xyz.jwlee.poker.server.support.Protocol;

/**
 * Room commands. The pipeline runs under the room lock inside {@code RoomRegistry.withRoom}. When the last
 * person leaves, the room closes under that lock and is removed from the registry only after the room lock
 * is released (lock order stays global then room; see {@code RoomRegistry}).
 */
@RestController
class CommandController {

    private static final int MAX_ID_LENGTH = 128;
    private static final int MAX_TYPE_LENGTH = 64;

    private final RoomRegistry registry;
    private final CommandPipeline pipeline = new CommandPipeline();

    CommandController(RoomRegistry registry) {
        this.registry = registry;
    }

    @PostMapping("/api/rooms/{roomId}/commands")
    ResponseEntity<ObjectNode> command(
            @PathVariable String roomId, @RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        CommandRequest command = parse(body);
        CommandPipeline.validateType(command);
        String participantId = participantIn(roomId, request);
        record Done(ResponseEntity<ObjectNode> response, boolean closed) { }
        Done done = registry.withRoom(roomId, room -> {
            CommandResult result = pipeline.execute(room, participantId, command);
            return new Done(respond(result.outcome(), room, participantId), room.isClosed());
        });
        if (done.closed()) {
            registry.remove(roomId);
        }
        return done.response();
    }

    @GetMapping("/api/rooms/{roomId}/requests/{requestId}")
    ResponseEntity<ObjectNode> request(
            @PathVariable String roomId, @PathVariable String requestId, HttpServletRequest request) {
        String participantId = participantIn(roomId, request);
        return registry.withRoom(roomId, room -> {
            Participant me = room.participant(participantId).orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
            RequestOutcome outcome = room.ledger(me.participantId(), me.controlGeneration()).find(requestId)
                    .orElseThrow(() -> new RoomException("REQUEST_NOT_FOUND"));
            return respond(outcome, room, participantId);
        });
    }

    private static String participantIn(String roomId, HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new RoomException("NO_SESSION");
        }
        // Not bound, or bound but no longer on the roster (checked again under the lock): a missing room.
        return SessionIdentity.from(session).participantIn(roomId)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
    }

    private static ResponseEntity<ObjectNode> respond(RequestOutcome outcome, Room room, String participantId) {
        ObjectNode o = JsonNodeFactory.instance.objectNode();
        o.put("requestId", outcome.requestId());
        o.put("sequence", outcome.sequence());
        o.put("outcome", outcome.outcome().name());
        o.put("code", outcome.code());
        o.put("resultStateVersion", outcome.resultStateVersion());
        // Whoever just left or was removed has no view of the room any more.
        Optional<Participant> me = room.participant(participantId);
        if (me.isPresent()) {
            o.set("latestState", SnapshotWriter.snapshot(room, me.get()).json());
        } else {
            o.putNull("latestState");
        }
        int status = outcome.outcome() == RequestOutcome.Outcome.APPLIED
                ? 200 : ApiExceptionHandler.rejectionStatus(outcome.code());
        return ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store").body(o);
    }

    /** The envelope, checked field by field for presence and type; the payload itself is left to the rules. */
    private static CommandRequest parse(JsonNode node) {
        if (node == null || !node.isObject()) {
            throw invalid();
        }
        JsonNode version = node.get("protocolVersion");
        if (version == null || !version.isIntegralNumber() || !version.canConvertToInt()) {
            throw invalid();
        }
        if (version.asInt() != Protocol.VERSION) {
            throw new RoomException("PROTOCOL_INCOMPATIBLE");
        }
        String requestId = text(node, "requestId", MAX_ID_LENGTH, true);
        String type = text(node, "type", MAX_TYPE_LENGTH, true);
        long sequence = number(node, "sequence", 1);
        long generation = number(node, "controlGeneration", 1);
        long expected = number(node, "expectedStateVersion", 0);
        String tournamentId = text(node, "tournamentId", MAX_ID_LENGTH, false);
        String handId = text(node, "handId", MAX_ID_LENGTH, false);
        JsonNode payload = node.get("payload");
        if (payload != null && payload.isNull()) {
            payload = null;
        }
        return new CommandRequest(
                version.asInt(), tournamentId, requestId, sequence, generation, expected, handId, type, payload);
    }

    private static String text(JsonNode node, String field, int max, boolean required) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) {
            if (required) {
                throw invalid();
            }
            return null;
        }
        if (!v.isString() || v.asString().isEmpty() || v.asString().length() > max) {
            throw invalid();
        }
        return v.asString();
    }

    private static long number(JsonNode node, String field, long min) {
        JsonNode v = node.get(field);
        if (v == null || !v.isIntegralNumber() || !v.canConvertToLong() || v.asLong() < min) {
            throw invalid();
        }
        return v.asLong();
    }

    private static RoomException invalid() {
        return new RoomException("INVALID_INPUT");
    }
}
