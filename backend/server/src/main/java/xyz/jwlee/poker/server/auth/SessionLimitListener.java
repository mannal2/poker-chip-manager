package xyz.jwlee.poker.server.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

// 살아 있는 세션 수를 세어 서버 전체 세션 한도 안에서만 새 세션을 만든다
@Component
class SessionLimitListener implements HttpSessionListener {

    private final AtomicInteger active = new AtomicInteger();
    private final int maxSessions;

    // 서버 전체 세션 한도를 받는다
    SessionLimitListener(@Value("${poker.rate-limit.max-sessions:2000}") int maxSessions) {
        this.maxSessions = maxSessions;
    }

    // 만들어진 세션을 센다
    @Override
    public void sessionCreated(HttpSessionEvent event) {
        active.incrementAndGet();
    }

    // 끝난 세션을 뺀다
    @Override
    public void sessionDestroyed(HttpSessionEvent event) {
        active.decrementAndGet();
    }

    // 자리가 있을 때만 새 세션을 만든다
    /** Serialized so that the check and the creation, which counts through {@link #sessionCreated}, are one step. */
    synchronized boolean tryOpen(HttpServletRequest request) {
        if (active.get() >= maxSessions) {
            return false;
        }
        request.getSession(true);
        return true;
    }
}
