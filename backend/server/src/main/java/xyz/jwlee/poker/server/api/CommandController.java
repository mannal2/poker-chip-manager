package xyz.jwlee.poker.server.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.time.Clock;
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
import xyz.jwlee.poker.server.room.Fingerprint;
import xyz.jwlee.poker.server.room.Participant;
import xyz.jwlee.poker.server.room.RequestLedger;
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
    private final CommandPipeline pipeline;

    CommandController(RoomRegistry registry, Clock clock) {
        this.registry = registry;
        this.pipeline = new CommandPipeline(clock);
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
            RequestOutcome outcome = room.findRequest(me, requestId)
                    .orElseThrow(() -> new RoomException("REQUEST_NOT_FOUND"));
            return respond(outcome, room, participantId);
        });
    }

    /**
     * Takes control on another screen. A takeover has no generation to belong to yet, so it is deduplicated by
     * the stream ledger of the screen asking: {@code synchronized (ledger) { check; do the work; record }}, with
     * the lock order of {@code RoomController}. A refusal is recorded (it uses up the sequence) and a retry
     * answers what the first attempt got, whatever has happened to the generation since.
     */
    @PostMapping("/api/rooms/{roomId}/control")
    ResponseEntity<ObjectNode> control(
            @PathVariable String roomId, @RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        requireObjectOfThisProtocol(body);
        String streamId = text(body, "streamId", MAX_ID_LENGTH, true);
        String requestId = text(body, "requestId", MAX_ID_LENGTH, true);
        long sequence = number(body, "sequence", 1);
        long expected = number(body, "expectedControlGeneration", 1);
        String fingerprint = Fingerprint.sha256("control\n" + roomId + "\n" + expected);
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new RoomException("NO_SESSION");
        }
        RequestLedger ledger = SessionIdentity.from(session).ledgerFor(streamId);
        synchronized (ledger) {
            Optional<RequestOutcome> replay = ledger.replayOf(requestId, sequence, fingerprint);
            if (replay.isPresent()) {
                RequestOutcome first = replay.get();
                if (first.outcome() == RequestOutcome.Outcome.REJECTED) {
                    throw new RoomException(first.code());
                }
                String participantId = participantIn(roomId, request);
                return registry.withRoom(roomId, room -> respondToControl(first, room, participantId));
            }
            try {
                String participantId = participantIn(roomId, request);
                return registry.withRoom(roomId, room -> {
                    long issued = CommandPipeline.takeControl(room, participantId, expected);
                    RequestOutcome outcome = new RequestOutcome(requestId, sequence, RequestOutcome.Outcome.APPLIED,
                            "OK", room.version(), null, issued);
                    // Record first: the work is done, so a failure while building the body must not lose it.
                    ledger.record(outcome, fingerprint);
                    return respondToControl(outcome, room, participantId);
                });
            } catch (RoomException e) {
                ledger.record(new RequestOutcome(
                        requestId, sequence, RequestOutcome.Outcome.REJECTED, e.code(), 0, null), fingerprint);
                throw e;
            }
        }
    }

    /** The generation is the one this request was issued; {@code latestState} shows the current one. */
    private static ResponseEntity<ObjectNode> respondToControl(RequestOutcome outcome, Room room, String participantId) {
        Participant me = room.participant(participantId).orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        ObjectNode o = JsonNodeFactory.instance.objectNode();
        o.put("requestId", outcome.requestId());
        o.put("sequence", outcome.sequence());
        o.put("outcome", outcome.outcome().name());
        o.put("code", outcome.code());
        o.put("controlGeneration", outcome.issuedGeneration());
        o.set("latestState", SnapshotWriter.snapshot(room, me).json());
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(o);
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
        int protocolVersion = requireObjectOfThisProtocol(node);
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
                protocolVersion, tournamentId, requestId, sequence, generation, expected, handId, type, payload);
    }

    private static int requireObjectOfThisProtocol(JsonNode node) {
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
        return version.asInt();
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
