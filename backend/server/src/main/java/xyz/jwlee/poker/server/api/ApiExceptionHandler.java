package xyz.jwlee.poker.server.api;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import xyz.jwlee.poker.server.room.RoomException;

// 도메인 거절과 프레임워크 오류를 오류 본문과 HTTP 상태로 바꾼다
/** Maps domain rejections and framework errors to {@code {code, message}} with the HTTP status table. */
@RestControllerAdvice
class ApiExceptionHandler {

    private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private static final Map<String, Integer> STATUS = Map.ofEntries(
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
            Map.entry("INVALID_NAME", 422),
            Map.entry("DUPLICATE_NAME", 422),
            Map.entry("NOT_WAITING", 422),
            Map.entry("ROOM_FULL", 422),
            Map.entry("RECOVERY_LIMIT", 422),
            Map.entry("ALREADY_PARTICIPANT", 422),
            Map.entry("RECOVERY_NOT_PENDING", 422),
            Map.entry("ROOM_LIMIT", 503),
            Map.entry("SESSION_LIMIT", 503));

    private static final String SESSION_LIMIT_RETRY_SECONDS = "60";

    // 방 도메인 예외를 코드에 맞는 HTTP 상태로 응답한다
    @ExceptionHandler(RoomException.class)
    ResponseEntity<ApiError> room(RoomException e) {
        // An unknown command type is a payload problem on the wire, so it reads INVALID_INPUT.
        String wire = e.code().equals("UNKNOWN_TYPE") ? "INVALID_INPUT" : e.code();
        return respond(STATUS.getOrDefault(e.code(), 500), wire);
    }

    // 기록된 거절 코드에 대응하는 HTTP 상태를 돌려준다
    /** Status of a rejection that was recorded in a ledger: 403 permission or not your turn, 404 no such seat, 409 stale or lost, else 422. */
    static int rejectionStatus(String code) {
        return switch (code) {
            case "FORBIDDEN", "NOT_YOUR_TURN" -> 403;
            case "RECOVERY_TARGET_NOT_FOUND" -> 404;
            case "STALE_STATE", "CONTROL_LOST", "TOURNAMENT_CHANGED", "HOST_TAKEOVER_CLOSED" -> 409;
            default -> 422;
        };
    }

    // 읽을 수 없는 요청 본문을 400으로 응답한다
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> unreadable(HttpMessageNotReadableException e) {
        return respond(400, "INVALID_INPUT");
    }

    // 쿼리 파라미터 형식 오류를 400으로 응답한다
    /** A query parameter that is not the number it should be. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiError> mistyped(MethodArgumentTypeMismatchException e) {
        return respond(400, "INVALID_INPUT");
    }

    // 그 밖의 예외를 로그에 남기고 일반 오류로 응답한다
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> other(Exception e) {
        if (e instanceof ErrorResponse er) {
            int status = er.getStatusCode().value();
            return respond(status, status == 400 ? "INVALID_INPUT" : "HTTP_ERROR");
        }
        LOG.error("Unhandled error", e);
        return respond(500, "INTERNAL_ERROR");
    }

    // 캐시 금지 헤더와 함께 오류 본문 응답을 만든다
    private static ResponseEntity<ApiError> respond(int status, String code) {
        ResponseEntity.BodyBuilder response =
                ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store");
        if (code.equals("SESSION_LIMIT")) {
            response.header(HttpHeaders.RETRY_AFTER, SESSION_LIMIT_RETRY_SECONDS);
        }
        return response.body(ApiError.of(code));
    }
}
