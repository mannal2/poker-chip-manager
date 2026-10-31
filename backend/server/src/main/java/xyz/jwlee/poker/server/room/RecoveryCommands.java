package xyz.jwlee.poker.server.room;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.game.settings.SettingsValidator;
import xyz.jwlee.poker.server.room.RecoveryRequests.Request;
import xyz.jwlee.poker.server.room.RecoveryRequests.Status;

// 기기 복구의 신청과 방장의 승인·거절 규칙을 방에 적용한다
/**
 * The caller holds the room lock. Approval gives the seat a new credential, so every binding of the old device stops
 * working at once, and a new control generation; it touches neither chips nor the host. Asking changes no seat.
 */
public final class RecoveryCommands {

    private RecoveryCommands() {}

    // 이름으로 자리를 찾아 신청을 만든다. 이 세션이 이미 이 방의 유효한 자리에 있으면 거절한다
    public static Request request(Room room, Optional<SeatBinding> caller, String name, RoomEnv env) {
        if (caller.flatMap(room::seatOf).isPresent()) {
            throw new RoomException("ALREADY_PARTICIPANT");
        }
        Participant seat = comparable(name).flatMap(wanted -> room.participants().stream()
                .filter(p -> comparable(p.name()).filter(wanted::equals).isPresent()).findFirst())
                .orElseThrow(() -> new RoomException("RECOVERY_TARGET_NOT_FOUND"));
        Request request = room.recoveryRequests().add(env.newId(), seat.participantId(), env.now());
        room.bumpVersion();
        return request;
    }

    // 대기 신청을 승인해 대상 자리의 자격과 조작 세대를 새로 정하고 옛 연결을 닫는다
    static void approve(Room room, Participant actor, CommandRequest command, RoomEnv env) {
        Instant now = env.now();
        Request request = pending(room, command.payload(), now);
        if (!room.hasParticipant(request.participantId())) {
            throw new RoomException("RECOVERY_TARGET_NOT_FOUND");
        }
        String credential = env.newId();
        room.recoverSeat(request.participantId(), credential, now);
        room.recoveryRequests().approve(request, credential, now);
    }

    // 대기 신청을 거절한다
    static void reject(Room room, Participant actor, CommandRequest command, RoomEnv env) {
        Instant now = env.now();
        room.recoveryRequests().reject(pending(room, command.payload(), now), now);
    }

    // payload가 가리키는 신청이 아직 대기 중인지 확인해 돌려준다
    private static Request pending(Room room, JsonNode payload, Instant now) {
        JsonNode id = payload == null || !payload.isObject() ? null : payload.get("recoveryRequestId");
        if (id == null || !id.isString()) {
            throw new RoomException("INVALID_INPUT");
        }
        return room.recoveryRequests().find(id.asString()).filter(r -> r.statusAt(now) == Status.PENDING)
                .orElseThrow(() -> new RoomException("RECOVERY_NOT_PENDING"));
    }

    // 이름을 공백 제거·NFC·소문자로 맞추고 이름 규칙에 어긋나면 빈 값을 돌려준다
    private static Optional<String> comparable(String name) {
        return SettingsValidator.normalizeName(name).map(n -> n.toLowerCase(Locale.ROOT));
    }
}
