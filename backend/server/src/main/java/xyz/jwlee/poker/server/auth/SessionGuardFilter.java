package xyz.jwlee.poker.server.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.web.filter.OncePerRequestFilter;

/** Answers state-changing requests without a live session with 401, before CSRF code can create one. */
final class SessionGuardFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String method = request.getMethod();
        boolean safe = method.equals("GET") || method.equals("HEAD");
        if (!safe && request.getSession(false) == null) {
            JsonErrors.write(response, 401, "NO_SESSION");
            return;
        }
        chain.doFilter(request, response);
    }
}
