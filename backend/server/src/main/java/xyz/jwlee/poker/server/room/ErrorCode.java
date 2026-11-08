package xyz.jwlee.poker.server.room;

import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

// 서버가 응답에 싣는 오류 코드와, 예외로 던져졌을 때의 HTTP 상태와 메시지를 한곳에 정의한다
/**
 * Every error code the server itself puts on the wire. {@code thrownStatus} is the HTTP status of a thrown
 * {@link RoomException} with this code ({@code null}: not listed, answered 500 as before). {@code message} is the
 * Korean text of the error body ({@code null}: the body repeats the code). Codes of the rules modules
 * ({@code RuleErrorCode} and others) are not here; they travel by name through {@link RoomException#rule}.
 */
public enum ErrorCode {
    ABORT_FIRST(null, "진행 중인 게임을 먼저 중단해 주세요."),
    ALREADY_PARTICIPANT(422, "이미 이 방에 참가하고 있습니다."),
    BODY_TOO_LARGE(null, "요청 본문이 너무 큽니다."),
    CONTROL_LOST(409, "조작 권한을 잃었습니다."),
    CSRF_REJECTED(null, null),
    DEPLOY_IN_PROGRESS(409, "다른 배포가 진행 중입니다."),
    DEPLOY_MISMATCH(409, "프로세스나 배포 식별이 맞지 않습니다."),
    DEPLOY_PENDING(null, "서버 업데이트가 끝나면 시작할 수 있습니다"),
    DUPLICATE_NAME(422, "같은 이름이 이미 있습니다."),
    FORBIDDEN(403, "이 작업을 할 권한이 없습니다."),
    HOST_TAKEOVER_CLOSED(409, "방장 인수 요청이 이미 닫혔습니다."),
    HTTP_ERROR(null, "요청을 처리할 수 없습니다."),
    INTERNAL_ERROR(null, "서버 오류가 발생했습니다."),
    INVALID_ACTION(null, "지금은 할 수 없는 행동입니다."),
    INVALID_INPUT(400, "요청 형식이 올바르지 않습니다."),
    INVALID_NAME(422, "이름은 한글, 영문, 숫자, 공백으로 1~10자여야 합니다."),
    INVALID_SETTINGS(null, null),
    NOT_CONNECTED(null, "접속하지 않은 참가자가 있습니다."),
    NOT_ELIMINATED(null, "진행 중에는 탈락한 참가자만 방을 나갈 수 있습니다."),
    NOT_WAITING(422, "이미 게임이 시작된 방입니다."),
    NOT_YOUR_TURN(null, "지금은 내 차례가 아닙니다."),
    NO_DEALER(null, null),
    NO_SESSION(401, "세션이 없습니다. 새로 고친 뒤 다시 시도해 주세요."),
    ORIGIN_REJECTED(null, null),
    PLAYER_COUNT(null, null),
    PROTOCOL_INCOMPATIBLE(409, "앱 버전이 서버와 맞지 않습니다. 새로 고침해 주세요."),
    RATE_LIMITED(null, "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요."),
    RECOVERY_LIMIT(422, "이 자리의 복구 신청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요."),
    RECOVERY_NOT_PENDING(422, "이미 처리되었거나 만료된 복구 신청입니다."),
    RECOVERY_TARGET_NOT_FOUND(404, "이 이름의 자리를 찾을 수 없습니다."),
    REQUEST_CONFLICT(409, "같은 순번에 다른 요청이 이미 있습니다."),
    REQUEST_NOT_FOUND(404, "해당 요청 결과를 찾을 수 없습니다."),
    RESULT_EXPIRED(409, "오래된 요청이라 결과를 다시 보낼 수 없습니다."),
    ROOM_FULL(422, "방이 가득 찼습니다."),
    ROOM_LIMIT(503, "지금은 방을 더 만들 수 없습니다."),
    ROOM_NOT_FOUND(404, "방을 찾을 수 없습니다."),
    SEQUENCE_GAP(409, "요청 순번이 맞지 않습니다."),
    SESSION_LIMIT(503, "접속자가 많습니다. 잠시 뒤 다시 시도해 주세요."),
    STALE_STATE(409, "방 상태가 바뀌었습니다. 최신 상태를 확인해 주세요."),
    TOO_MANY_STREAMS(null, null),
    TOURNAMENT_CHANGED(409, "진행 중인 게임이 바뀌었습니다."),
    TRANSFER_HOST_FIRST(null, "방장은 방장을 넘긴 뒤에 기권하거나 나갈 수 있습니다."),
    UNDO_DEPLOY_PENDING(null, "서버 업데이트 중이라 취소할 수 없습니다"),
    UNDO_LOCKED(null, null),
    UNKNOWN_STREAM(409, "등록되지 않은 화면입니다."),
    UNKNOWN_TYPE(422, null);

    private static final Map<String, ErrorCode> BY_NAME =
            Arrays.stream(values()).collect(Collectors.toUnmodifiableMap(Enum::name, Function.identity()));

    private final Integer thrownStatus;
    private final String message;

    ErrorCode(Integer thrownStatus, String message) {
        this.thrownStatus = thrownStatus;
        this.message = message;
    }

    // 이름으로 서버 오류 코드를 찾는다
    public static Optional<ErrorCode> find(String code) {
        return Optional.ofNullable(BY_NAME.get(code));
    }

    // 예외로 던져진 코드의 HTTP 상태를 돌려주고, 정해지지 않았으면 500이다
    public static int thrownStatus(String code) {
        return find(code).map(c -> c.thrownStatus).orElse(500);
    }

    // 원장에 거절로 기록된 코드의 HTTP 상태를 돌려준다
    /** 403 permission or not your turn, 404 no such seat, 409 stale or lost, else 422. */
    public static int recordedStatus(String code) {
        return switch (code) {
            case "FORBIDDEN", "NOT_YOUR_TURN" -> 403;
            case "RECOVERY_TARGET_NOT_FOUND" -> 404;
            case "STALE_STATE", "CONTROL_LOST", "TOURNAMENT_CHANGED", "HOST_TAKEOVER_CLOSED" -> 409;
            default -> 422;
        };
    }

    // 응답에 실을 코드 이름을 돌려주며, 알 수 없는 명령 종류는 입력 오류로 보인다
    public static String wire(String code) {
        return UNKNOWN_TYPE.name().equals(code) ? INVALID_INPUT.name() : code;
    }

    // 응답 본문의 메시지를 돌려주며, 정해진 메시지가 없으면 코드를 그대로 쓴다
    public static String messageOf(String code) {
        return find(code).map(c -> c.message).orElse(code);
    }
}
