package xyz.jwlee.poker.server.api;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import xyz.jwlee.poker.server.room.ErrorCode;
import xyz.jwlee.poker.server.room.RoomException;

// 도메인 거절과 프레임워크 오류를 오류 본문과 HTTP 상태로 바꾼다
/** Maps domain rejections and framework errors to {@code {code, message}} with the HTTP status table. */
@RestControllerAdvice
class ApiExceptionHandler {

    private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private static final String SESSION_LIMIT_RETRY_SECONDS = "60";

    // 방 도메인 예외를 코드에 맞는 HTTP 상태로 응답한다
    @ExceptionHandler(RoomException.class)
    ResponseEntity<ApiError> room(RoomException e) {
        return respond(ErrorCode.thrownStatus(e.code()), ErrorCode.wire(e.code()));
    }

    // 읽을 수 없는 요청 본문을 400으로 응답한다
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> unreadable(HttpMessageNotReadableException e) {
        return respond(400, ErrorCode.INVALID_INPUT.name());
    }

    // 쿼리 파라미터 형식 오류를 400으로 응답한다
    /** A query parameter that is not the number it should be. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiError> mistyped(MethodArgumentTypeMismatchException e) {
        return respond(400, ErrorCode.INVALID_INPUT.name());
    }

    // 그 밖의 예외를 로그에 남기고 일반 오류로 응답한다
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> other(Exception e) {
        if (e instanceof ErrorResponse er) {
            int status = er.getStatusCode().value();
            return respond(status, status == 400 ? ErrorCode.INVALID_INPUT.name() : ErrorCode.HTTP_ERROR.name());
        }
        LOG.error("Unhandled error", e);
        return respond(500, ErrorCode.INTERNAL_ERROR.name());
    }

    // 캐시 금지 헤더와 함께 오류 본문 응답을 만든다
    private static ResponseEntity<ApiError> respond(int status, String code) {
        ResponseEntity.BodyBuilder response =
                ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store");
        if (code.equals(ErrorCode.SESSION_LIMIT.name())) {
            response.header(HttpHeaders.RETRY_AFTER, SESSION_LIMIT_RETRY_SECONDS);
        }
        return response.body(ApiError.of(code));
    }
}
