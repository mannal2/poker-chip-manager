package xyz.jwlee.poker.server.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.jwlee.poker.server.support.IdGenerator;
import xyz.jwlee.poker.server.support.Protocol;

@RestController
class SessionController {

    static final int MAX_STREAMS = 8;

    private final IdGenerator ids;

    SessionController(IdGenerator ids) {
        this.ids = ids;
    }

    @GetMapping("/api/session")
    Map<String, Object> session(HttpServletRequest request, HttpServletResponse response, CsrfToken csrf) {
        request.getSession(true);
        response.setHeader("Cache-Control", "no-store");
        // getToken() loads or creates the deferred token and stores it in the session.
        return Map.of("csrfToken", csrf.getToken(), "protocolVersion", Protocol.VERSION);
    }

    @PostMapping("/api/session/streams")
    ResponseEntity<Map<String, String>> openStream(HttpServletRequest request) {
        SessionIdentity identity = SessionIdentity.from(request.getSession(false));
        String streamId = ids.next();
        if (!identity.openStream(streamId, MAX_STREAMS)) {
            return ResponseEntity.status(409).body(Map.of("code", "TOO_MANY_STREAMS"));
        }
        return ResponseEntity.ok(Map.of("streamId", streamId));
    }
}
