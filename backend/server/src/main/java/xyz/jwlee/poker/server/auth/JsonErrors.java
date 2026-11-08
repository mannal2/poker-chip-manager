package xyz.jwlee.poker.server.auth;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import xyz.jwlee.poker.server.room.ErrorCode;

// 필터에서 JSON 오류 본문을 직접 써 주는 도우미
/** Writes the {@code {code}} error body from filters, where MVC error handling is not available. */
final class JsonErrors {

    private JsonErrors() {}

    // 상태 코드와 오류 코드를 JSON 응답으로 쓴다
    static void write(HttpServletResponse response, int status, ErrorCode code) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write("{\"code\":\"" + code.name() + "\"}");
    }
}
