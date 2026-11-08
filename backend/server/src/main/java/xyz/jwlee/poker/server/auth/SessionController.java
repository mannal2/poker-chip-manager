package xyz.jwlee.poker.server.auth;

import jakarta.servlet.SessionCookieConfig;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.jwlee.poker.server.room.ErrorCode;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.support.IdGenerator;
import xyz.jwlee.poker.server.support.Protocol;

// 세션 생성, 유지, 화면 스트림 등록을 처리하는 컨트롤러
@RestController
class SessionController {

    static final int MAX_STREAMS = 8;

    private final IdGenerator ids;
    private final SessionLimitListener limit;

    SessionController(IdGenerator ids, SessionLimitListener limit) {
        this.ids = ids;
        this.limit = limit;
    }

    // 세션을 만들고 CSRF 토큰과 프로토콜 버전을 돌려주며 서버 전체 한도를 넘는 새 세션은 거절한다
    @GetMapping("/api/session")
    Map<String, Object> session(HttpServletRequest request, HttpServletResponse response, CsrfToken csrf) {
        if (request.getSession(false) == null && !limit.tryOpen(request)) {
            throw new RoomException(ErrorCode.SESSION_LIMIT);
        }
        response.setHeader("Cache-Control", "no-store");
        // getToken() loads or creates the deferred token and stores it in the session.
        return Map.of("csrfToken", csrf.getToken(), "protocolVersion", Protocol.VERSION);
    }

    // 세션 쿠키를 새 만료 시간으로 다시 보내 세션을 유지한다
    /** Keeps a live session alive: Tomcat sets the cookie only at creation, so it is sent again with a fresh Max-Age. */
    @PostMapping("/api/session/refresh")
    Map<String, Object> refresh(HttpServletRequest request, HttpServletResponse response, CsrfToken csrf) {
        HttpSession session = request.getSession(false);
        SessionCookieConfig cfg = request.getServletContext().getSessionCookieConfig();
        ResponseCookie cookie = ResponseCookie.from(cfg.getName(), session.getId())
                .path("/").httpOnly(cfg.isHttpOnly()).secure(cfg.isSecure())
                .maxAge(cfg.getMaxAge()).sameSite("Lax").build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        response.setHeader("Cache-Control", "no-store");
        return Map.of("csrfToken", csrf.getToken(), "protocolVersion", Protocol.VERSION);
    }

    // 화면 스트림과 그 요청 원장을 지운다. 없는 스트림도 204로 답한다
    @DeleteMapping("/api/session/streams/{streamId}")
    ResponseEntity<Void> closeStream(@PathVariable String streamId, HttpServletRequest request) {
        SessionIdentity.from(request.getSession(false)).closeStream(streamId);
        return ResponseEntity.noContent().build();
    }

    // 화면 스트림을 새로 등록하고 id를 돌려주며 한도를 넘으면 거절한다
    @PostMapping("/api/session/streams")
    ResponseEntity<Map<String, String>> openStream(HttpServletRequest request) {
        SessionIdentity identity = SessionIdentity.from(request.getSession(false));
        String streamId = ids.next();
        if (!identity.openStream(streamId, MAX_STREAMS)) {
            return ResponseEntity.status(409).body(Map.of("code", ErrorCode.TOO_MANY_STREAMS.name()));
        }
        return ResponseEntity.ok(Map.of("streamId", streamId));
    }
}
