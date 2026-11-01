package xyz.jwlee.poker.server.realtime;

import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import org.springframework.stereotype.Component;

// 세션이 끝나면 그 세션의 연결을 모두 접근 회수로 닫는다
/** Lives here, not in auth, because auth must not know about realtime. */
@Component
class SessionExpiryListener implements HttpSessionListener {

    private final ConnectionHub hub;

    // 세션 만료를 연결 허브에 알릴 수 있게 허브를 받는다
    SessionExpiryListener(ConnectionHub hub) {
        this.hub = hub;
    }

    // 만료되거나 무효화된 세션의 연결을 닫는다
    @Override
    public void sessionDestroyed(HttpSessionEvent event) {
        hub.revokeSession(event.getSession().getId());
    }
}
