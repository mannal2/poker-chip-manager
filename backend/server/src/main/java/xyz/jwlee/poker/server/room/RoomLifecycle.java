package xyz.jwlee.poker.server.room;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

// 연결 전환과 시간 규칙으로 방의 수명(자리 만료, 방장 인수, 방 삭제)을 판정한다
/**
 * The room's time rules (MULTIPLAYER_MODE section 13, SYSTEM_SPEC section 9). Every decision reads the current
 * connections and the injected clock, so a late sweep cannot act on a state that has already changed. The caller
 * holds the room lock; a room this closes leaves the registry in {@code RoomRegistry.update}, after that lock is released.
 */
public final class RoomLifecycle {

    static final Duration WAITING_RECONNECT_GRACE = Duration.ofSeconds(5);
    static final Duration FIRST_CONNECTION_WAIT = Duration.ofSeconds(30);
    static final Duration HOST_TAKEOVER_DELAY = Duration.ofSeconds(60);
    public static final Duration ABANDONED_ROOM_LIMIT = Duration.ofMinutes(30);
    static final Duration RECOVERY_REQUEST_LIFETIME = Duration.ofMinutes(5);

    private RoomLifecycle() {}

    // 연결을 붙이고 끊김에서 접속으로 바뀌었으면 방장의 인수 요청을 닫고 자동 처리를 이어 간다
    public static void connected(Room room, String participantId, String connectionId, RoomEnv env) {
        if (!room.presence().attach(participantId, connectionId, env.now())) {
            return;
        }
        if (room.isHost(participantId)) {
            room.closeHostTakeover();
        }
        room.bumpVersion();
        AutoPlay.run(room, env);
    }

    // 연결을 떼고 접속에서 끊김으로 바뀌었으면 버전을 올리고 자동 처리를 이어 간다
    public static void disconnected(Room room, String connectionId, RoomEnv env) {
        if (!room.presence().detach(connectionId, env.now())) {
            return;
        }
        room.bumpVersion();
        AutoPlay.run(room, env);
    }

    // 현재 단계의 시간 규칙을 기본 방 삭제 시간으로 한 번 판정한다
    public static void sweep(Room room, RoomEnv env) {
        sweep(room, env, ABANDONED_ROOM_LIMIT);
    }

    // 전원 미접속 방을 abandonedLimit 뒤에 닫는 시간 규칙을 한 번 판정한다
    public static void sweep(Room room, RoomEnv env, Duration abandonedLimit) {
        Instant now = env.now();
        if (room.recoveryRequests().sweep(now)) {
            room.bumpVersion();
        }
        switch (room.phase()) {
            case WAITING -> expireAbsences(room, now);
            case PLAYING, RESULT -> {
                if (everyoneGone(room, abandonedLimit, now)) {
                    room.close();
                } else {
                    openHostTakeover(room, now);
                }
            }
        }
    }

    // 유예가 끝난 대기방 참가자를 명단에서 뺀다
    private static void expireAbsences(Room room, Instant now) {
        List<String> expired = room.participants().stream().map(Participant::participantId)
                .filter(id -> graceOver(room, id, now)).toList();
        expired.forEach(id -> room.removeParticipant(id, now));
        if (!expired.isEmpty()) {
            room.bumpVersion();
        }
    }

    // 참가자의 대기방 유예(첫 연결 전 30초, 그 뒤 끊김 5초)가 끝났는지 확인한다
    private static boolean graceOver(Room room, String participantId, Instant now) {
        Presence presence = room.presence();
        Duration grace = presence.neverConnected(participantId) ? FIRST_CONNECTION_WAIT : WAITING_RECONNECT_GRACE;
        return absentFor(room, participantId, grace, now);
    }

    // 지금 전원이 끊겨 있고 마지막 사람이 끊긴 지 30분이 지났는지 확인한다
    private static boolean everyoneGone(Room room, Duration limit, Instant now) {
        return room.participants().stream()
                .allMatch(p -> absentFor(room, p.participantId(), limit, now));
    }

    // 방장이 60초 이상 끊겼으면 인수 요청을 한 번 연다
    private static void openHostTakeover(Room room, Instant now) {
        if (!room.hostTakeoverOpen() && absentFor(room, room.hostId(), HOST_TAKEOVER_DELAY, now)) {
            room.openHostTakeover();
            room.bumpVersion();
        }
    }

    // 참가자가 지금 끊겨 있고 그 시간이 주어진 길이 이상인지 확인한다
    private static boolean absentFor(Room room, String participantId, Duration length, Instant now) {
        return room.presence().absentSince(participantId)
                .filter(since -> !now.isBefore(since.plus(length))).isPresent();
    }
}
