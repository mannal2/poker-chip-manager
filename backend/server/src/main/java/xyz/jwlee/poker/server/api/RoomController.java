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
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.RoomSnapshot;
import xyz.jwlee.poker.server.room.SeatBinding;
import xyz.jwlee.poker.server.room.SnapshotWriter;
import xyz.jwlee.poker.server.support.Protocol;

// 방 생성, 입장, 상태 조회를 처리하는 컨트롤러
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

    // 새 방을 만들고, 방장으로 등록된 요청자의 참가자 ID를 세션에 저장한다
    @PostMapping("/api/rooms")
    ResponseEntity<ObjectNode> create(@RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        Fields f = Fields.parse(body);
        String name = f.string("name");
        return bind(request, f, "create\n" + name, 201,
                identity -> registry.create(normalized(name), identity::bind));
    }

    // 방 코드로 기존 방에 입장하고, 요청자의 방별 참가자 ID를 세션에 저장한다
    @PostMapping("/api/room-joins")
    ResponseEntity<ObjectNode> join(@RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        Fields f = Fields.parse(body);
        String code = f.string("code");
        String name = f.string("name");
        return bind(request, f, "join\n" + code + "\n" + name, 200, identity -> {
            String canonical = RoomCodes.normalize(code).orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
            return registry.join(canonical, name, identity::bindingIn, identity::bind, RoomController::normalized);
        });
    }

    // 요청자 시점의 방 상태 스냅샷을 돌려준다
    @GetMapping("/api/rooms/{roomId}/state")
    ResponseEntity<ObjectNode> state(@PathVariable String roomId, HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new RoomException("NO_SESSION");
        }
        // Not bound, or bound to a seat this session no longer holds: both look like a missing room.
        SeatBinding binding = SessionIdentity.from(session).bindingIn(roomId)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        RoomSnapshot snapshot = registry.withRoom(roomId,
                room -> SnapshotWriter.snapshot(room, member(room.seatOf(binding))));
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(snapshot.json());
    }

    // 요청 원장으로 중복을 걸러내며 생성/입장 작업을 한 번만 실행한다
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
            Optional<RequestOutcome> replay = ledger.replayOf(f.requestId, f.sequence, fingerprint);
            if (replay.isPresent()) {
                RequestOutcome outcome = replay.get();
                if (outcome.outcome() == RequestOutcome.Outcome.REJECTED) {
                    throw new RoomException(outcome.code());
                }
                return respond(okStatus, outcome.roomId(), identity);
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
            return respond(okStatus, entry.roomId(), identity);
        }
    }

    // 세션이 지금 들고 있는 자리로 응답을 만든다
    private ResponseEntity<ObjectNode> respond(int status, String roomId, SessionIdentity identity) {
        SeatBinding binding = identity.bindingIn(roomId).orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        ObjectNode body = registry.withRoom(roomId, room -> entry(room, member(room.seatOf(binding))));
        return ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store").body(body);
    }

    // 방과 참가자 정보, 상태 스냅샷을 응답 본문으로 만든다. 호출자가 방 잠금을 잡고 있다
    static ObjectNode entry(Room room, Participant me) {
        RoomSnapshot snapshot = SnapshotWriter.snapshot(room, me);
        ObjectNode o = JsonNodeFactory.instance.objectNode();
        o.put("roomId", room.roomId());
        o.put("code", room.code());
        o.put("participantId", me.participantId());
        o.put("controlGeneration", me.controlGeneration());
        o.set("state", snapshot.json());
        return o;
    }

    // 참가자가 없으면 방을 찾을 수 없다는 예외를 던진다
    private static Participant member(Optional<Participant> p) {
        return p.orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
    }

    // 이름을 정규화하고 규칙에 어긋나면 예외를 던진다
    private static String normalized(String name) {
        return SettingsValidator.normalizeName(name).orElseThrow(() -> new RoomException("INVALID_NAME"));
    }

    // 생성/입장 요청의 공통 필드(스트림, 요청 id, 순번)를 검증해 담는다
    /** The envelope every create/join request carries, validated field by field (type and presence). */
    static final class Fields {

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

        // 본문과 프로토콜 버전, 공통 필드를 검증해 Fields를 만든다
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

        // 문자열 필드를 읽고 형식이 틀리면 예외를 던진다
        String string(String field) {
            JsonNode v = node.get(field);
            if (v == null || !v.isString()) {
                throw invalid();
            }
            return v.asString();
        }

        // 비어 있지 않고 길이 제한을 지키는 id 문자열을 읽는다
        private static String id(JsonNode node, String field) {
            JsonNode v = node.get(field);
            if (v == null || !v.isString() || v.asString().isEmpty() || v.asString().length() > MAX_ID_LENGTH) {
                throw invalid();
            }
            return v.asString();
        }

        // 입력 형식 오류 예외를 만든다
        private static RoomException invalid() {
            return new RoomException("INVALID_INPUT");
        }
    }
}
