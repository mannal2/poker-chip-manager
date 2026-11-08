package xyz.jwlee.poker.server.api;

import xyz.jwlee.poker.server.room.ErrorCode;

// API 오류 응답 본문(오류 코드와 한국어 메시지)
/** The JSON error body: a stable machine code and a short Korean message for the screen. */
record ApiError(String code, String message) {

    // 서버 오류 코드로 오류 본문을 만든다
    static ApiError of(ErrorCode code) {
        return of(code.name());
    }

    // 오류 코드에 해당하는 메시지를 붙여 오류 본문을 만든다
    static ApiError of(String code) {
        return new ApiError(code, ErrorCode.messageOf(code));
    }
}
