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
import xyz.jwlee.poker.server.registry.RoomCodes;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.Fingerprint;
import xyz.jwlee.poker.server.room.RecoveryCommands;
import xyz.jwlee.poker.server.room.RecoveryRequests;
import xyz.jwlee.poker.server.room.RecoveryRequests.Status;
import xyz.jwlee.poker.server.room.RequestLedger;
import xyz.jwlee.poker.server.room.RequestOutcome;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomEnv;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.SeatBinding;
import xyz.jwlee.poker.server.support.IdGenerator;

// 새 기기의 복구 신청과 신청 결과 조회를 처리하는 컨트롤러
/**
 * A request is no seat: its id is remembered only in the asking session, so another session's read is a 404, and the
 * asker has no room access until a read of an approved request links the session to the seat. That read can repeat,
 * so a device that lost the answer gets it again. Asking is deduplicated like create and join, with the same lock
 * order: ledger, then room lock, then the session monitor.
 */
@RestController
class RecoveryController {

    private final RoomRegistry registry;
    private final RoomEnv env;

    RecoveryController(RoomRegistry registry, Clock clock, IdGenerator ids) {
        this.registry = registry;
        this.env = new RoomEnv(clock, ids);
    }

    // 방 코드와 이름으로 복구를 신청한다
    @PostMapping("/api/recovery-requests")
    ResponseEntity<ObjectNode> ask(@RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        RoomController.Fields f = RoomController.Fields.parse(body);
        String code = f.string("code");
        String name = f.string("name");
        String fingerprint = Fingerprint.sha256("recovery\n" + code + "\n" + name);
        SessionIdentity identity = identity(request);
        RequestLedger ledger = identity.ledgerFor(f.streamId);
        synchronized (ledger) {
            Optional<RequestOutcome> replay = ledger.replayOf(f.requestId, f.sequence, fingerprint);
            if (replay.isPresent()) {
                RequestOutcome first = replay.get();
                if (first.outcome() == RequestOutcome.Outcome.REJECTED) {
                    throw new RoomException(first.code());
                }
                return created(registry.withRoom(first.roomId(), room -> describe(room, first.recoveryRequestId())));
            }
            RequestOutcome outcome;
            try {
                outcome = create(identity, code, name, f);
            } catch (RoomException e) {
                ledger.record(new RequestOutcome(
                        f.requestId, f.sequence, RequestOutcome.Outcome.REJECTED, e.code(), 0, null), fingerprint);
                throw e;
            }
            // Record first: the work is done, so a failure while building the body must not lose the outcome.
            ledger.record(outcome, fingerprint);
            return created(registry.withRoom(outcome.roomId(), room -> describe(room, outcome.recoveryRequestId())));
        }
    }

    // 방을 찾아 잠금 안에서 신청을 만들고 세션에 기억한다
    private RequestOutcome create(SessionIdentity identity, String code, String name, RoomController.Fields f) {
        Room found = RoomCodes.normalize(code).flatMap(registry::findByCode)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        return registry.update(found.roomId(), room -> {
            String id = RecoveryCommands.request(room, identity.bindingIn(room.roomId()), name, env).id();
            identity.rememberRecovery(id, room.roomId());
            return RequestOutcome.recovery(f.requestId, f.sequence, room.version(), room.roomId(), id);
        });
    }

    // 자기 신청의 결과를 돌려주고, 승인되었으면 세션을 그 자리에 연결한다
    @GetMapping("/api/recovery-requests/{id}")
    ResponseEntity<ObjectNode> read(@PathVariable String id, HttpServletRequest request) {
        SessionIdentity identity = identity(request);
        String roomId = identity.recoveryRoom(id).orElseThrow(() -> new RoomException("REQUEST_NOT_FOUND"));
        ObjectNode answer;
        try {
            answer = registry.withRoom(roomId, room -> outcomeOf(room, id, identity));
        } catch (RoomException e) {
            identity.forgetRecovery(id);
            throw e;
        }
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(answer);
    }

    // 신청 상태를 본문으로 만들고, 아직 그 자리를 열 수 있는 승인이면 자리 정보를 더한다
    private ObjectNode outcomeOf(Room room, String id, SessionIdentity identity) {
        RecoveryRequests.Request found = require(room, id);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("recoveryRequestId", id);
        Status status = found.statusAt(env.now());
        if (status != Status.APPROVED) {
            return body.put("status", status.name());
        }
        SeatBinding binding = new SeatBinding(found.participantId(), found.credential());
        // A later recovery or a kick took the seat from this approval: it opens nothing any more.
        // Nor does it replace another seat this session holds: the owner of the approved seat has to ask again.
        if (room.seatOf(binding).isEmpty() || holdsAnotherSeat(room, identity, binding)) {
            return body.put("status", Status.SUPERSEDED.name());
        }
        identity.bind(room.roomId(), binding);
        body.put("status", status.name());
        body.setAll(RoomController.entry(room, room.seatOf(binding).orElseThrow()));
        return body;
    }

    // 세션이 승인된 자리가 아닌 다른 유효한 자리를 이 방에서 들고 있는지 확인한다
    private static boolean holdsAnotherSeat(Room room, SessionIdentity identity, SeatBinding approved) {
        return identity.bindingIn(room.roomId()).filter(held -> !held.equals(approved))
                .flatMap(room::seatOf).isPresent();
    }

    // 신청 생성 응답 본문을 만든다
    private ObjectNode describe(Room room, String id) {
        RecoveryRequests.Request found = require(room, id);
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("recoveryRequestId", id);
        body.put("status", found.statusAt(env.now()).name());
        body.put("expiresAt", found.expiresAt().toString());
        return body;
    }

    // 방의 신청을 찾고 지워졌으면 예외를 던진다
    private static RecoveryRequests.Request require(Room room, String id) {
        return room.recoveryRequests().find(id).orElseThrow(() -> new RoomException("REQUEST_NOT_FOUND"));
    }

    // 201 응답을 만든다
    private static ResponseEntity<ObjectNode> created(ObjectNode body) {
        return ResponseEntity.status(201).header(HttpHeaders.CACHE_CONTROL, "no-store").body(body);
    }

    // 요청의 세션을 찾고 없으면 예외를 던진다
    private static SessionIdentity identity(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new RoomException("NO_SESSION");
        }
        return SessionIdentity.from(session);
    }
}
