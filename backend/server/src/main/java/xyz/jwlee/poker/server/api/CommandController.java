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
import xyz.jwlee.poker.server.room.SeatBinding;
import xyz.jwlee.poker.server.room.SnapshotWriter;
import xyz.jwlee.poker.server.support.IdGenerator;
import xyz.jwlee.poker.server.support.Protocol;

// 방 안에서 게임 명령과 조작권 인수 요청을 받아 처리하는 컨트롤러
/**
 * Room commands. The pipeline runs under the room lock inside {@code RoomRegistry.update}, which also publishes
 * the change and removes a room the last person left, both after that lock is released.
 */
@RestController
class CommandController {

    private static final int MAX_ID_LENGTH = 128;
    private static final int MAX_TYPE_LENGTH = 64;

    private final RoomRegistry registry;
    private final CommandPipeline pipeline;

    CommandController(RoomRegistry registry, Clock clock, IdGenerator ids) {
        this.registry = registry;
        this.pipeline = new CommandPipeline(clock, ids);
    }

    // 명령을 검증하고 방 잠금 안에서 파이프라인으로 실행해 결과를 응답한다
    @PostMapping("/api/rooms/{roomId}/commands")
    ResponseEntity<ObjectNode> command(
            @PathVariable String roomId, @RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        CommandRequest command = parse(body);
        CommandPipeline.validateType(command);
        SeatBinding binding = bindingIn(roomId, request);
        return registry.update(roomId, room -> {
            CommandResult result = pipeline.execute(room, seat(room, binding).participantId(), command);
            return respond(result.outcome(), room, binding);
        });
    }

    // 이미 처리된 요청의 결과를 다시 조회한다
    @GetMapping("/api/rooms/{roomId}/requests/{requestId}")
    ResponseEntity<ObjectNode> request(
            @PathVariable String roomId, @PathVariable String requestId, HttpServletRequest request) {
        SeatBinding binding = bindingIn(roomId, request);
        return registry.withRoom(roomId, room -> {
            RequestOutcome outcome = room.findRequest(seat(room, binding), requestId)
                    .orElseThrow(() -> new RoomException("REQUEST_NOT_FOUND"));
            return respond(outcome, room, binding);
        });
    }

    // 다른 화면에서 조작권을 가져오고, 재시도는 처음 결과를 그대로 돌려준다
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
                return respondToControl(first, roomId, request);
            }
            RequestOutcome outcome;
            try {
                SeatBinding binding = bindingIn(roomId, request);
                outcome = registry.update(roomId, room -> {
                    String participantId = seat(room, binding).participantId();
                    long issued = CommandPipeline.takeControl(room, participantId, expected);
                    return RequestOutcome.takeover(requestId, sequence, room.version(), issued, participantId);
                });
            } catch (RoomException e) {
                ledger.record(new RequestOutcome(
                        requestId, sequence, RequestOutcome.Outcome.REJECTED, e.code(), 0, null), fingerprint);
                throw e;
            }
            // Record first: the work is done, so a failure while building the body must not lose the outcome.
            ledger.record(outcome, fingerprint);
            return respondToControl(outcome, roomId, request);
        }
    }

    // 조작권 인수 결과와 최신 방 상태를 응답 본문으로 만든다
    /**
     * The generation is the one this request was issued; {@code latestState} shows the current one. A first answer
     * and a retry both pass the seat check: the seat may have gone to another device, or this session may have been
     * kicked and rejoined as a participant the generation was not issued to.
     */
    private ResponseEntity<ObjectNode> respondToControl(
            RequestOutcome outcome, String roomId, HttpServletRequest request) {
        SeatBinding binding = bindingIn(roomId, request);
        return registry.withRoom(roomId, room -> {
            Participant me = seat(room, binding);
            if (!outcome.issuedTo().equals(me.participantId())) {
                throw new RoomException("ROOM_NOT_FOUND");
            }
            ObjectNode o = JsonNodeFactory.instance.objectNode();
            o.put("requestId", outcome.requestId());
            o.put("sequence", outcome.sequence());
            o.put("outcome", outcome.outcome().name());
            o.put("code", outcome.code());
            o.put("controlGeneration", outcome.issuedGeneration());
            o.set("latestState", SnapshotWriter.snapshot(room, me).json());
            return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(o);
        });
    }

    // 방 잠금 안에서 세션의 자격이 여는 자리를 찾는다
    private static Participant seat(Room room, SeatBinding binding) {
        return room.seatOf(binding).orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
    }

    // 세션이 이 방에 들고 있는 자리 자격을 찾는다
    private static SeatBinding bindingIn(String roomId, HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new RoomException("NO_SESSION");
        }
        // Not bound: a missing room. Whether the binding still opens a seat is checked under the room lock.
        return SessionIdentity.from(session).bindingIn(roomId)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
    }

    // 명령 처리 결과와 최신 방 상태를 응답 본문으로 만든다
    private static ResponseEntity<ObjectNode> respond(RequestOutcome outcome, Room room, SeatBinding binding) {
        ObjectNode o = JsonNodeFactory.instance.objectNode();
        o.put("requestId", outcome.requestId());
        o.put("sequence", outcome.sequence());
        o.put("outcome", outcome.outcome().name());
        o.put("code", outcome.code());
        o.put("resultStateVersion", outcome.resultStateVersion());
        // Whoever just left, was removed or approved their own seat away has no view of the room any more.
        Optional<Participant> me = room.seatOf(binding);
        if (me.isPresent()) {
            o.set("latestState", SnapshotWriter.snapshot(room, me.get()).json());
        } else {
            o.putNull("latestState");
        }
        int status = outcome.outcome() == RequestOutcome.Outcome.APPLIED
                ? 200 : ApiExceptionHandler.rejectionStatus(outcome.code());
        return ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store").body(o);
    }

    // 요청 본문의 공통 필드를 검증해 명령 요청 객체로 만든다
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

    // 본문이 객체이고 프로토콜 버전이 맞는지 확인한다
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

    // 문자열 필드의 존재와 길이를 검증해 읽는다
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

    // 정수 필드의 형식과 최솟값을 검증해 읽는다
    private static long number(JsonNode node, String field, long min) {
        JsonNode v = node.get(field);
        if (v == null || !v.isIntegralNumber() || !v.canConvertToLong() || v.asLong() < min) {
            throw invalid();
        }
        return v.asLong();
    }

    // 입력 형식 오류 예외를 만든다
    private static RoomException invalid() {
        return new RoomException("INVALID_INPUT");
    }
}
