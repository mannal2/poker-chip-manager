package xyz.jwlee.poker.server.auth;

import jakarta.servlet.http.HttpSession;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

// WebSocket 핸드셰이크의 Origin과 세션을 검사하고 세션을 연결에 넘긴다
/** A handshake is a GET, which the HTTP Origin filter lets through, so the Origin is checked here. */
@Component
public final class WebSocketHandshakeGuard implements HandshakeInterceptor {

    private static final String IDENTITY = "pcm.identity";

    private final Set<String> allowed;

    WebSocketHandshakeGuard(AuthProperties props) {
        this.allowed = Set.copyOf(props.allowedOrigins());
    }

    // 소켓 속성에서 핸드셰이크 때 확인한 세션을 꺼낸다
    public static SessionIdentity identityOf(Map<String, Object> attributes) {
        return (SessionIdentity) attributes.get(IDENTITY);
    }

    // 허용된 Origin 목록을 돌려준다
    public String[] allowedOrigins() {
        return allowed.toArray(String[]::new);
    }

    // Origin이 없거나 허용되지 않으면 403, 세션이 없으면 401로 거절한다
    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
            Map<String, Object> attributes) {
        String origin = request.getHeaders().getFirst(HttpHeaders.ORIGIN);
        if (origin == null || !allowed.contains(origin)) {
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return false;
        }
        HttpSession session = request instanceof ServletServerHttpRequest servlet
                ? servlet.getServletRequest().getSession(false) : null;
        if (session == null) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        attributes.put(IDENTITY, SessionIdentity.from(session));
        return true;
    }

    // 핸드셰이크 뒤에는 할 일이 없다
    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
            Exception exception) {
    }
}
