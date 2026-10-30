package xyz.jwlee.poker.server.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Real HTTP: cookies, CSRF and Origin are checked end to end, with cookies handled by hand. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SessionSecurityHttpTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @LocalServerPort
    int port;

    private final HttpClient client = HttpClient.newHttpClient();

    private HttpResponse<String> send(String method, String path, String cookie, String csrf, String origin)
            throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .method(method, method.equals("GET") ? BodyPublishers.noBody() : BodyPublishers.ofString(""));
        if (cookie != null) {
            b.header("Cookie", cookie);
        }
        if (csrf != null) {
            b.header("X-CSRF-TOKEN", csrf);
        }
        if (origin != null) {
            b.header("Origin", origin);
        }
        return client.send(b.build(), BodyHandlers.ofString());
    }

    private record Session(String cookie, String csrf) {}

    private Session open() throws Exception {
        HttpResponse<String> r = send("GET", "/api/session", null, null, null);
        String setCookie = r.headers().firstValue("Set-Cookie").orElseThrow();
        return new Session(setCookie.split(";", 2)[0], MAPPER.readTree(r.body()).get("csrfToken").asString());
    }

    @Test
    void sessionEndpointSetsAnHttpOnlyLaxCookieAndReturnsTheToken() throws Exception {
        HttpResponse<String> r = send("GET", "/api/session", null, null, null);

        assertThat(r.statusCode()).isEqualTo(200);
        String setCookie = r.headers().firstValue("Set-Cookie").orElseThrow();
        assertThat(setCookie).startsWith("PCM_SESSION=").containsIgnoringCase("HttpOnly")
                .containsIgnoringCase("SameSite=Lax");
        assertThat(r.headers().firstValue("Cache-Control").orElseThrow()).contains("no-store");
        JsonNode body = MAPPER.readTree(r.body());
        assertThat(body.get("csrfToken").asString()).isNotBlank();
        assertThat(body.get("protocolVersion").asInt()).isEqualTo(1);
    }

    @Test
    void postWithCookieTokenAndAllowedOriginOpensAStream() throws Exception {
        Session s = open();

        HttpResponse<String> r = send("POST", "/api/session/streams", s.cookie(), s.csrf(), ORIGIN);

        assertThat(r.statusCode()).isEqualTo(200);
        assertThat(MAPPER.readTree(r.body()).get("streamId").asString()).isNotBlank();
    }

    @Test
    void postWithoutTheTokenIsForbidden() throws Exception {
        Session s = open();

        HttpResponse<String> r = send("POST", "/api/session/streams", s.cookie(), null, ORIGIN);

        assertThat(r.statusCode()).isEqualTo(403);
    }

    @Test
    void postFromAnotherOriginIsRejected() throws Exception {
        Session s = open();

        HttpResponse<String> r = send("POST", "/api/session/streams", s.cookie(), s.csrf(), "http://evil.example");

        assertThat(r.statusCode()).isEqualTo(403);
        assertThat(MAPPER.readTree(r.body()).get("code").asString()).isEqualTo("ORIGIN_REJECTED");
    }

    @Test
    void postWithoutAnOriginIsRejected() throws Exception {
        Session s = open();

        HttpResponse<String> r = send("POST", "/api/session/streams", s.cookie(), s.csrf(), null);

        assertThat(r.statusCode()).isEqualTo(403);
        assertThat(MAPPER.readTree(r.body()).get("code").asString()).isEqualTo("ORIGIN_REJECTED");
    }

    @Test
    void postWithoutASessionIsUnauthorizedAsJson() throws Exception {
        HttpResponse<String> r = send("POST", "/api/session/streams", null, null, ORIGIN);

        assertThat(r.statusCode()).isEqualTo(401);
        assertThat(MAPPER.readTree(r.body()).get("code").asString()).isEqualTo("NO_SESSION");
    }

    @Test
    void healthStaysPublicWithoutASession() throws Exception {
        HttpResponse<String> r = send("GET", "/api/health", null, null, null);

        assertThat(r.statusCode()).isEqualTo(200);
        assertThat(r.headers().firstValue("Set-Cookie")).isEmpty();
    }
}
