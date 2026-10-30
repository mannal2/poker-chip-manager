package xyz.jwlee.poker.server.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Rejects request bodies over {@value #MAX_BYTES} bytes with 413. A declared Content-Length is checked up
 * front; a body without one (chunked) is read, at most one byte past the limit, and replayed to the app.
 */
final class BodySizeFilter extends OncePerRequestFilter {

    static final int MAX_BYTES = 32 * 1024;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long declared = request.getContentLengthLong();
        if (declared > MAX_BYTES) {
            error(response, 413, "BODY_TOO_LARGE");
            return;
        }
        if (declared >= 0) {
            chain.doFilter(request, response);
            return;
        }
        byte[] body;
        try {
            body = request.getInputStream().readNBytes(MAX_BYTES + 1);
        } catch (IOException e) {
            // A truncated or malformed chunked body is the client's error.
            error(response, 400, "INVALID_INPUT");
            return;
        }
        if (body.length > MAX_BYTES) {
            error(response, 413, "BODY_TOO_LARGE");
            return;
        }
        chain.doFilter(new ReplayedBody(request, body), response);
    }

    private static void error(HttpServletResponse response, int status, String code) throws IOException {
        ApiError error = ApiError.of(code);
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Connection", "close");
        response.getWriter().write("{\"code\":\"" + error.code() + "\",\"message\":\"" + error.message() + "\"}");
    }

    /** The already-read body, handed to the rest of the chain as if it were still the live stream. */
    private static final class ReplayedBody extends HttpServletRequestWrapper {

        private final byte[] body;

        ReplayedBody(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream in = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() {
                    return in.read();
                }

                @Override
                public int read(byte[] b, int off, int len) {
                    return in.read(b, off, len);
                }

                @Override
                public boolean isFinished() {
                    return in.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener listener) {
                    throw new IllegalStateException("async reads are not supported");
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null ? StandardCharsets.UTF_8 : Charset.forName(encoding);
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }
}
