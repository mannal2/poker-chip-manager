package xyz.jwlee.poker.server.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.Optional;
import java.util.function.Function;
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
import xyz.jwlee.poker.game.settings.SettingsValidator;
import xyz.jwlee.poker.server.auth.SessionIdentity;
import xyz.jwlee.poker.server.registry.RoomCodes;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.Fingerprint;
import xyz.jwlee.poker.server.room.Participant;
import xyz.jwlee.poker.server.room.RequestLedger;
import xyz.jwlee.poker.server.room.RequestOutcome;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.RoomSnapshot;
import xyz.jwlee.poker.server.room.SnapshotWriter;
import xyz.jwlee.poker.server.support.Protocol;

/**
 * Create, join and read a room. Create and join are deduplicated by the request ledger of the screen
 * stream they came from: {@code synchronized (ledger) { check; do the work; record }}.
 * Lock order: ledger, then the registry global lock, then a room lock, then (innermost, a leaf) the
 * HttpSession monitor taken by {@code SessionIdentity}.
 */
@RestController
class RoomController {

    private static final int MAX_ID_LENGTH = 128;

    private final RoomRegistry registry;

    RoomController(RoomRegistry registry) {
        this.registry = registry;
    }

    @PostMapping("/api/rooms")
    ResponseEntity<ObjectNode> create(@RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        Fields f = Fields.parse(body);
        String name = f.string("name");
        return bind(request, f, "create\n" + name, 201,
                identity -> registry.create(normalized(name), identity::bind));
    }

    @PostMapping("/api/room-joins")
    ResponseEntity<ObjectNode> join(@RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        Fields f = Fields.parse(body);
        String code = f.string("code");
        String name = f.string("name");
        return bind(request, f, "join\n" + code + "\n" + name, 200, identity -> {
            String canonical = RoomCodes.normalize(code).orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
            return registry.join(canonical, name, identity::participantIn, identity::bind, RoomController::normalized);
        });
    }

    @GetMapping("/api/rooms/{roomId}/state")
    ResponseEntity<ObjectNode> state(@PathVariable String roomId, HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new RoomException("NO_SESSION");
        }
        // Not bound, or bound but no longer on the roster: both look like a missing room.
        String participantId = SessionIdentity.from(session).participantIn(roomId)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        RoomSnapshot snapshot = registry.withRoom(roomId,
                room -> SnapshotWriter.snapshot(room, member(room.participant(participantId))));
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(snapshot.json());
    }

    private ResponseEntity<ObjectNode> bind(
            HttpServletRequest request, Fields f, String payload, int okStatus,
            Function<SessionIdentity, RoomRegistry.Entry> work) {
        // A digest, not the payload: the ledger keeps 64 fingerprints per stream.
        String fingerprint = Fingerprint.sha256(payload);
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new RoomException("NO_SESSION");
        }
        SessionIdentity identity = SessionIdentity.from(session);
        RequestLedger ledger = identity.ledgerFor(f.streamId);
        synchronized (ledger) {
            switch (ledger.check(f.requestId, f.sequence, fingerprint)) {
                case RequestLedger.Check.Replay replay -> {
                    RequestOutcome outcome = replay.outcome();
                    if (outcome.outcome() == RequestOutcome.Outcome.REJECTED) {
                        throw new RoomException(outcome.code());
                    }
                    String roomId = outcome.roomId();
                    String participantId = identity.participantIn(roomId)
                            .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
                    return respond(okStatus, roomId, participantId);
                }
                case RequestLedger.Check.Conflict c -> throw new RoomException("REQUEST_CONFLICT");
                case RequestLedger.Check.Expired e -> throw new RoomException("RESULT_EXPIRED");
                case RequestLedger.Check.Gap g -> throw new RoomException("SEQUENCE_GAP");
                case RequestLedger.Check.New n -> { }
            }
            RoomRegistry.Entry entry;
            try {
                entry = work.apply(identity);
            } catch (RoomException e) {
                ledger.record(new RequestOutcome(
                        f.requestId, f.sequence, RequestOutcome.Outcome.REJECTED, e.code(), 0, null), fingerprint);
                throw e;
            }
            // Record first: the work is done, so a failure while building the body must not lose the outcome.
            ledger.record(new RequestOutcome(f.requestId, f.sequence, RequestOutcome.Outcome.APPLIED, "OK",
                    entry.stateVersion(), entry.roomId()), fingerprint);
            return respond(okStatus, entry.roomId(), entry.participantId());
        }
    }

    private ResponseEntity<ObjectNode> respond(int status, String roomId, String participantId) {
        ObjectNode body = registry.withRoom(roomId, room -> {
            Participant me = member(room.participant(participantId));
            RoomSnapshot snapshot = SnapshotWriter.snapshot(room, me);
            ObjectNode o = JsonNodeFactory.instance.objectNode();
            o.put("roomId", room.roomId());
            o.put("code", room.code());
            o.put("participantId", me.participantId());
            o.put("controlGeneration", me.controlGeneration());
            o.set("state", snapshot.json());
            return o;
        });
        return ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store").body(body);
    }

    private static Participant member(Optional<Participant> p) {
        return p.orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
    }

    private static String normalized(String name) {
        return SettingsValidator.normalizeName(name).orElseThrow(() -> new RoomException("INVALID_NAME"));
    }

    /** The envelope every create/join request carries, validated field by field (type and presence). */
    private static final class Fields {

        private final JsonNode node;
        final String streamId;
        final String requestId;
        final long sequence;

        private Fields(JsonNode node, String streamId, String requestId, long sequence) {
            this.node = node;
            this.streamId = streamId;
            this.requestId = requestId;
            this.sequence = sequence;
        }

        static Fields parse(JsonNode node) {
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
            String streamId = id(node, "streamId");
            String requestId = id(node, "requestId");
            JsonNode seq = node.get("sequence");
            if (seq == null || !seq.isIntegralNumber() || !seq.canConvertToLong() || seq.asLong() < 1) {
                throw invalid();
            }
            return new Fields(node, streamId, requestId, seq.asLong());
        }

        String string(String field) {
            JsonNode v = node.get(field);
            if (v == null || !v.isString()) {
                throw invalid();
            }
            return v.asString();
        }

        private static String id(JsonNode node, String field) {
            JsonNode v = node.get(field);
            if (v == null || !v.isString() || v.asString().isEmpty() || v.asString().length() > MAX_ID_LENGTH) {
                throw invalid();
            }
            return v.asString();
        }

        private static RoomException invalid() {
            return new RoomException("INVALID_INPUT");
        }
    }
}
