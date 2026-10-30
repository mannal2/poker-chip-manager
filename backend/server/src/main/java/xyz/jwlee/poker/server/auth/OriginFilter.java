package xyz.jwlee.poker.server.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.web.filter.OncePerRequestFilter;

/** Rejects state-changing requests whose Origin header is missing or not on the allow-list. */
final class OriginFilter extends OncePerRequestFilter {

    private final Set<String> allowed;

    OriginFilter(Set<String> allowed) {
        this.allowed = Set.copyOf(allowed);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String method = request.getMethod();
        boolean safe = method.equals("GET") || method.equals("HEAD");
        String origin = request.getHeader("Origin");
        if (!safe && (origin == null || !allowed.contains(origin))) {
            JsonErrors.write(response, 403, "ORIGIN_REJECTED");
            return;
        }
        chain.doFilter(request, response);
    }
}
