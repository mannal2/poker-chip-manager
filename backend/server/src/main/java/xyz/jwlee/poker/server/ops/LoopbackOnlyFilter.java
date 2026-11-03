package xyz.jwlee.poker.server.ops;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.util.Objects;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

// 내부 경로를 컨테이너 안 loopback 요청에만 열고 나머지는 없는 경로처럼 404로 답한다
/**
 * Runs before the security chain, which is what lets that chain skip CSRF, Origin and session checks for
 * {@code /internal}. Only the socket's address counts: a proxy can write any forwarded header.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class LoopbackOnlyFilter extends OncePerRequestFilter {

    private static final String PREFIX = "/internal";

    // 내부 경로가 아닌 요청은 이 필터를 건너뛴다
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getServletPath() + Objects.toString(request.getPathInfo(), "");
        return !path.equals(PREFIX) && !path.startsWith(PREFIX + "/");
    }

    // 접속 주소가 loopback일 때만 통과시킨다
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!isLoopback(request.getRemoteAddr())) {
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        chain.doFilter(request, response);
    }

    // 이름 조회 없이 주소 문자열이 loopback인지 판정한다
    private static boolean isLoopback(String address) {
        try {
            return address != null && InetAddress.ofLiteral(address).isLoopbackAddress();
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
