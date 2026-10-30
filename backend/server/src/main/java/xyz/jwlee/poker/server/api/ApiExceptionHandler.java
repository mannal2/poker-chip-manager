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
            Map.entry("UNKNOWN_TYPE", 422),
            Map.entry("STALE_STATE", 409),
            Map.entry("CONTROL_LOST", 409),
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
            Map.entry("ROOM_LIMIT", 503));

    @ExceptionHandler(RoomException.class)
    ResponseEntity<ApiError> room(RoomException e) {
        // An unknown command type is a payload problem on the wire, so it reads INVALID_INPUT.
        String wire = e.code().equals("UNKNOWN_TYPE") ? "INVALID_INPUT" : e.code();
        return respond(STATUS.getOrDefault(e.code(), 500), wire);
    }

    /** Status of a rejection that was recorded in a ledger: 403 permission or not your turn, 409 stale or lost, else 422. */
    static int rejectionStatus(String code) {
        return switch (code) {
            case "FORBIDDEN", "NOT_YOUR_TURN" -> 403;
            case "STALE_STATE", "CONTROL_LOST", "TOURNAMENT_CHANGED" -> 409;
            default -> 422;
        };
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> unreadable(HttpMessageNotReadableException e) {
        return respond(400, "INVALID_INPUT");
    }

    /** A query parameter that is not the number it should be. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiError> mistyped(MethodArgumentTypeMismatchException e) {
        return respond(400, "INVALID_INPUT");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> other(Exception e) {
        if (e instanceof ErrorResponse er) {
            int status = er.getStatusCode().value();
            return respond(status, status == 400 ? "INVALID_INPUT" : "HTTP_ERROR");
        }
        LOG.error("Unhandled error", e);
        return respond(500, "INTERNAL_ERROR");
    }

    private static ResponseEntity<ApiError> respond(int status, String code) {
        return ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store").body(ApiError.of(code));
    }
}
