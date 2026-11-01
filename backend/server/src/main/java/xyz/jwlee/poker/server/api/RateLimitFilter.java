package xyz.jwlee.poker.server.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.Objects;
import java.util.regex.Pattern;
import org.springframework.web.filter.OncePerRequestFilter;
import xyz.jwlee.poker.server.support.TokenBuckets;

// 명령과 입장 시도의 빈도를 세어 한도를 넘으면 429로 거절하는 필터
/**
 * Runs before the security chain and every request ledger, so a refused request leaves no trace and can be sent
 * again with the same sequence. Paths come from the servlet API because the raw URI may be percent-encoded.
 */
final class RateLimitFilter extends OncePerRequestFilter {

    private static final Pattern SESSION_PATH = Pattern.compile("/api/rooms/[^/]+/(commands|control)");
    private static final int MAX_SESSION_KEYS = 4_000;
    private static final int MAX_ADDRESS_KEYS = 10_000;
    private static final Duration IDLE = Duration.ofMinutes(10);

    private final Limit sessions;
    private final Limit addresses;
    private final Limit rooms;
    private final String clientIpHeader;

    // 설정값으로 세션·IP·방 생성 버킷을 만든다
    RateLimitFilter(RateLimitProperties limits, String clientIpHeader, Clock clock) {
        sessions = Limit.of(limits.sessionPerSecond(), limits.sessionBurst(), MAX_SESSION_KEYS, clock);
        addresses = Limit.of(limits.ipPerMinute() / 60, limits.ipBurst(), MAX_ADDRESS_KEYS, clock);
        rooms = Limit.of(limits.roomPerMinute() / 60, limits.roomBurst(), MAX_ADDRESS_KEYS, clock);
        this.clientIpHeader = clientIpHeader;
    }

    // POST 외의 요청은 세지 않는다
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getMethod().equals("POST");
    }

    // 경로에 맞는 버킷의 토큰을 쓰고 통과시키거나 429로 거절한다
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Limit refusedBy = refusedBy(request);
        if (refusedBy != null) {
            refuse(response, refusedBy.retryAfterSeconds());
            return;
        }
        chain.doFilter(request, response);
    }

    // 요청을 거절한 한도를 돌려주고 통과면 null을 돌려준다
    private Limit refusedBy(HttpServletRequest request) {
        String path = request.getServletPath() + Objects.toString(request.getPathInfo(), "");
        if (SESSION_PATH.matcher(path).matches()) {
            HttpSession session = request.getSession(false);
            return session == null || sessions.buckets().tryTake(session.getId()) ? null : sessions;
        }
        // The stricter limit goes first, so refused room creations do not use up the address's join budget.
        if (path.equals("/api/rooms") && !rooms.buckets().tryTake(clientIp(request))) {
            return rooms;
        }
        if (path.equals("/api/rooms") || path.equals("/api/room-joins") || path.equals("/api/recovery-requests")) {
            return addresses.buckets().tryTake(clientIp(request)) ? null : addresses;
        }
        return null;
    }

    // 설정된 프록시 헤더가 있으면 그 값을, 없으면 접속 주소를 쓴다
    private String clientIp(HttpServletRequest request) {
        String reported = clientIpHeader.isEmpty() ? null : request.getHeader(clientIpHeader);
        return reported == null || reported.isBlank() ? request.getRemoteAddr() : reported.strip();
    }

    // 429 본문과 다시 시도할 시각을 쓴다
    private static void refuse(HttpServletResponse response, long retryAfterSeconds) throws IOException {
        ApiError error = ApiError.of("RATE_LIMITED");
        response.setStatus(429);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Retry-After", Long.toString(retryAfterSeconds));
        response.getWriter().write("{\"code\":\"" + error.code() + "\",\"message\":\"" + error.message() + "\"}");
    }

    // 버킷과 토큰 하나가 회복되는 시간
    private record Limit(TokenBuckets buckets, long retryAfterSeconds) {

        // 초당 회복량으로 버킷과 대기 시간을 만든다
        static Limit of(double perSecond, int burst, int maxKeys, Clock clock) {
            return new Limit(new TokenBuckets(perSecond, burst, maxKeys, IDLE, clock),
                    (long) Math.ceil(1 / perSecond));
        }
    }
}
