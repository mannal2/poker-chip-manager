package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

// 오류 코드 enum이 옮기기 전의 상태·메시지 표와 같은 값을 주는지 확인한다
class ErrorCodeTest {

    // 옮기기 전 ApiExceptionHandler의 STATUS 표(2026-11-08)
    private static final Map<String, Integer> THROWN = Map.ofEntries(
            Map.entry("INVALID_INPUT", 400),
            Map.entry("NO_SESSION", 401),
            Map.entry("FORBIDDEN", 403),
            Map.entry("ROOM_NOT_FOUND", 404),
            Map.entry("REQUEST_NOT_FOUND", 404),
            Map.entry("RECOVERY_TARGET_NOT_FOUND", 404),
            Map.entry("UNKNOWN_TYPE", 422),
            Map.entry("STALE_STATE", 409),
            Map.entry("CONTROL_LOST", 409),
            Map.entry("HOST_TAKEOVER_CLOSED", 409),
            Map.entry("TOURNAMENT_CHANGED", 409),
            Map.entry("PROTOCOL_INCOMPATIBLE", 409),
            Map.entry("REQUEST_CONFLICT", 409),
            Map.entry("RESULT_EXPIRED", 409),
            Map.entry("SEQUENCE_GAP", 409),
            Map.entry("UNKNOWN_STREAM", 409),
            Map.entry("DEPLOY_IN_PROGRESS", 409),
            Map.entry("DEPLOY_MISMATCH", 409),
            Map.entry("INVALID_NAME", 422),
            Map.entry("DUPLICATE_NAME", 422),
            Map.entry("NOT_WAITING", 422),
            Map.entry("ROOM_FULL", 422),
            Map.entry("RECOVERY_LIMIT", 422),
            Map.entry("ALREADY_PARTICIPANT", 422),
            Map.entry("RECOVERY_NOT_PENDING", 422),
            Map.entry("ROOM_LIMIT", 503),
            Map.entry("SESSION_LIMIT", 503));

    // 옮기기 전 ApiError의 메시지 표(2026-11-08)
    private static final Map<String, String> MESSAGES = Map.ofEntries(
            Map.entry("INVALID_INPUT", "요청 형식이 올바르지 않습니다."),
            Map.entry("INVALID_NAME", "이름은 한글, 영문, 숫자, 공백으로 1~10자여야 합니다."),
            Map.entry("DUPLICATE_NAME", "같은 이름이 이미 있습니다."),
            Map.entry("NO_SESSION", "세션이 없습니다. 새로 고친 뒤 다시 시도해 주세요."),
            Map.entry("ROOM_NOT_FOUND", "방을 찾을 수 없습니다."),
            Map.entry("FORBIDDEN", "이 작업을 할 권한이 없습니다."),
            Map.entry("STALE_STATE", "방 상태가 바뀌었습니다. 최신 상태를 확인해 주세요."),
            Map.entry("CONTROL_LOST", "조작 권한을 잃었습니다."),
            Map.entry("TOURNAMENT_CHANGED", "진행 중인 게임이 바뀌었습니다."),
            Map.entry("HOST_TAKEOVER_CLOSED", "방장 인수 요청이 이미 닫혔습니다."),
            Map.entry("NOT_CONNECTED", "접속하지 않은 참가자가 있습니다."),
            Map.entry("NOT_ELIMINATED", "진행 중에는 탈락한 참가자만 방을 나갈 수 있습니다."),
            Map.entry("RECOVERY_TARGET_NOT_FOUND", "이 이름의 자리를 찾을 수 없습니다."),
            Map.entry("RECOVERY_LIMIT", "이 자리의 복구 신청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요."),
            Map.entry("ALREADY_PARTICIPANT", "이미 이 방에 참가하고 있습니다."),
            Map.entry("RECOVERY_NOT_PENDING", "이미 처리되었거나 만료된 복구 신청입니다."),
            Map.entry("NOT_YOUR_TURN", "지금은 내 차례가 아닙니다."),
            Map.entry("INVALID_ACTION", "지금은 할 수 없는 행동입니다."),
            Map.entry("ABORT_FIRST", "진행 중인 게임을 먼저 중단해 주세요."),
            Map.entry("TRANSFER_HOST_FIRST", "방장은 방장을 넘긴 뒤에 기권하거나 나갈 수 있습니다."),
            Map.entry("REQUEST_NOT_FOUND", "해당 요청 결과를 찾을 수 없습니다."),
            Map.entry("NOT_WAITING", "이미 게임이 시작된 방입니다."),
            Map.entry("DEPLOY_PENDING", "서버 업데이트가 끝나면 시작할 수 있습니다"),
            Map.entry("UNDO_DEPLOY_PENDING", "서버 업데이트 중이라 취소할 수 없습니다"),
            Map.entry("DEPLOY_IN_PROGRESS", "다른 배포가 진행 중입니다."),
            Map.entry("DEPLOY_MISMATCH", "프로세스나 배포 식별이 맞지 않습니다."),
            Map.entry("ROOM_FULL", "방이 가득 찼습니다."),
            Map.entry("ROOM_LIMIT", "지금은 방을 더 만들 수 없습니다."),
            Map.entry("RATE_LIMITED", "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요."),
            Map.entry("SESSION_LIMIT", "접속자가 많습니다. 잠시 뒤 다시 시도해 주세요."),
            Map.entry("PROTOCOL_INCOMPATIBLE", "앱 버전이 서버와 맞지 않습니다. 새로 고침해 주세요."),
            Map.entry("REQUEST_CONFLICT", "같은 순번에 다른 요청이 이미 있습니다."),
            Map.entry("RESULT_EXPIRED", "오래된 요청이라 결과를 다시 보낼 수 없습니다."),
            Map.entry("SEQUENCE_GAP", "요청 순번이 맞지 않습니다."),
            Map.entry("UNKNOWN_STREAM", "등록되지 않은 화면입니다."),
            Map.entry("BODY_TOO_LARGE", "요청 본문이 너무 큽니다."),
            Map.entry("HTTP_ERROR", "요청을 처리할 수 없습니다."),
            Map.entry("INTERNAL_ERROR", "서버 오류가 발생했습니다."));

    @Test
    void thrownStatusMatchesTheFormerTable() {
        for (ErrorCode code : ErrorCode.values()) {
            assertThat(ErrorCode.thrownStatus(code.name())).as(code.name())
                    .isEqualTo(THROWN.getOrDefault(code.name(), 500));
        }
        THROWN.forEach((code, status) -> assertThat(ErrorCode.thrownStatus(code)).as(code).isEqualTo(status));
        assertThat(ErrorCode.thrownStatus("MIN_RAISE")).isEqualTo(500);
    }

    @Test
    void messagesMatchTheFormerTable() {
        MESSAGES.forEach((code, message) -> assertThat(ErrorCode.messageOf(code)).as(code).isEqualTo(message));
        for (ErrorCode code : ErrorCode.values()) {
            assertThat(ErrorCode.messageOf(code.name())).as(code.name())
                    .isEqualTo(MESSAGES.getOrDefault(code.name(), code.name()));
        }
        assertThat(ErrorCode.messageOf("MIN_RAISE")).isEqualTo("MIN_RAISE");
    }

    @Test
    void recordedStatusKeepsTheFormerRules() {
        assertThat(ErrorCode.recordedStatus("FORBIDDEN")).isEqualTo(403);
        assertThat(ErrorCode.recordedStatus("NOT_YOUR_TURN")).isEqualTo(403);
        assertThat(ErrorCode.recordedStatus("RECOVERY_TARGET_NOT_FOUND")).isEqualTo(404);
        for (String code : new String[] {"STALE_STATE", "CONTROL_LOST", "TOURNAMENT_CHANGED", "HOST_TAKEOVER_CLOSED"}) {
            assertThat(ErrorCode.recordedStatus(code)).as(code).isEqualTo(409);
        }
        assertThat(ErrorCode.recordedStatus("INVALID_INPUT")).isEqualTo(422);
        assertThat(ErrorCode.recordedStatus("MIN_RAISE")).isEqualTo(422);
    }

    @Test
    void anUnknownCommandTypeReadsAsInvalidInput() {
        assertThat(ErrorCode.wire("UNKNOWN_TYPE")).isEqualTo("INVALID_INPUT");
        assertThat(ErrorCode.wire("ROOM_FULL")).isEqualTo("ROOM_FULL");
    }
}
