package xyz.jwlee.poker.server.api;

import java.util.Map;

// API 오류 응답 본문(오류 코드와 한국어 메시지)
/** The JSON error body: a stable machine code and a short Korean message for the screen. */
record ApiError(String code, String message) {

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
            Map.entry("NOT_YOUR_TURN", "지금은 내 차례가 아닙니다."),
            Map.entry("INVALID_ACTION", "지금은 할 수 없는 행동입니다."),
            Map.entry("ABORT_FIRST", "진행 중인 게임을 먼저 중단해 주세요."),
            Map.entry("TRANSFER_HOST_FIRST", "방장은 방장을 넘긴 뒤에 기권할 수 있습니다."),
            Map.entry("REQUEST_NOT_FOUND", "해당 요청 결과를 찾을 수 없습니다."),
            Map.entry("NOT_WAITING", "이미 게임이 시작된 방입니다."),
            Map.entry("ROOM_FULL", "방이 가득 찼습니다."),
            Map.entry("ROOM_LIMIT", "지금은 방을 더 만들 수 없습니다."),
            Map.entry("PROTOCOL_INCOMPATIBLE", "앱 버전이 서버와 맞지 않습니다. 새로 고침해 주세요."),
            Map.entry("REQUEST_CONFLICT", "같은 순번에 다른 요청이 이미 있습니다."),
            Map.entry("RESULT_EXPIRED", "오래된 요청이라 결과를 다시 보낼 수 없습니다."),
            Map.entry("SEQUENCE_GAP", "요청 순번이 맞지 않습니다."),
            Map.entry("UNKNOWN_STREAM", "등록되지 않은 화면입니다."),
            Map.entry("BODY_TOO_LARGE", "요청 본문이 너무 큽니다."),
            Map.entry("HTTP_ERROR", "요청을 처리할 수 없습니다."),
            Map.entry("INTERNAL_ERROR", "서버 오류가 발생했습니다."));

    // 오류 코드에 해당하는 메시지를 붙여 오류 본문을 만든다
    static ApiError of(String code) {
        return new ApiError(code, MESSAGES.getOrDefault(code, code));
    }
}
