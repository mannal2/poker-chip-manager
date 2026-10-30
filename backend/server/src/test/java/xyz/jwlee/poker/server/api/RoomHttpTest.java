package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublisher;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.ObjectMapper;

/** Real HTTP: session fixation protection and the body-size limit, with cookies handled by hand. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RoomHttpTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @LocalServerPort
    int port;

    private final HttpClient client = HttpClient.newHttpClient();

    private HttpResponse<String> send(String method, String path, String cookie, String csrf, BodyPublisher body)
            throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .method(method, body).header("Origin", ORIGIN).header("Content-Type", "application/json");
        if (cookie != null) {
            b.header("Cookie", cookie);
        }
        if (csrf != null) {
            b.header("X-CSRF-TOKEN", csrf);
        }
        return client.send(b.build(), BodyHandlers.ofString());
    }

    private record Session(String cookie, String csrf, String streamId) {}

    private Session open() throws Exception {
        HttpResponse<String> r = send("GET", "/api/session", null, null, BodyPublishers.noBody());
        String cookie = r.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
        String csrf = MAPPER.readTree(r.body()).get("csrfToken").asString();
        HttpResponse<String> s = send("POST", "/api/session/streams", cookie, csrf, BodyPublishers.ofString(""));
        return new Session(cookie, csrf, MAPPER.readTree(s.body()).get("streamId").asString());
    }

    private static String createBody(Session s, String name) {
        return "{\"protocolVersion\":1,\"streamId\":\"" + s.streamId() + "\",\"requestId\":\"r1\",\"sequence\":1,"
                + "\"name\":\"" + name + "\"}";
    }

    @Test
    void bindingAParticipantRotatesTheSessionCookie() throws Exception {
        Session s = open();

        HttpResponse<String> r = send("POST", "/api/rooms", s.cookie(), s.csrf(),
                BodyPublishers.ofString(createBody(s, "Alice")));

        assertThat(r.statusCode()).isEqualTo(201);
        String setCookie = r.headers().firstValue("Set-Cookie").orElseThrow();
        String newCookie = setCookie.split(";", 2)[0];
        assertThat(newCookie).startsWith("PCM_SESSION=").isNotEqualTo(s.cookie());
        assertThat(setCookie).contains("Max-Age=604800").containsIgnoringCase("HttpOnly");
        String roomId = MAPPER.readTree(r.body()).get("roomId").asString();
        String statePath = "/api/rooms/" + roomId + "/state";

        assertThat(send("GET", statePath, s.cookie(), null, BodyPublishers.noBody()).statusCode()).isEqualTo(401);
        HttpResponse<String> ok = send("GET", statePath, newCookie, null, BodyPublishers.noBody());
        assertThat(ok.statusCode()).isEqualTo(200);
        assertThat(MAPPER.readTree(ok.body()).get("you").get("participantId").asString())
                .isEqualTo(MAPPER.readTree(r.body()).get("participantId").asString());
        // The CSRF token survives the rotation.
        HttpResponse<String> next = send("POST", "/api/session/streams", newCookie, s.csrf(),
                BodyPublishers.ofString(""));
        assertThat(next.statusCode()).isEqualTo(200);
    }

    @Test
    void aDeclaredBodyOverTheLimitIsRejectedWith413() throws Exception {
        Session s = open();
        String big = createBody(s, "A").replace("\"name\"", "\"pad\":\"" + "x".repeat(40_000) + "\",\"name\"");

        HttpResponse<String> r = send("POST", "/api/rooms", s.cookie(), s.csrf(), BodyPublishers.ofString(big));

        assertThat(r.statusCode()).isEqualTo(413);
        assertThat(MAPPER.readTree(r.body()).get("code").asString()).isEqualTo("BODY_TOO_LARGE");
    }

    @Test
    void aChunkedBodyOverTheLimitIsRejectedWith413() throws Exception {
        Session s = open();
        byte[] big = ("{\"pad\":\"" + "x".repeat(40_000) + "\"}").getBytes(StandardCharsets.UTF_8);

        HttpResponse<String> r = send("POST", "/api/rooms", s.cookie(), s.csrf(),
                BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(big)));

        assertThat(r.statusCode()).isEqualTo(413);
        assertThat(MAPPER.readTree(r.body()).get("code").asString()).isEqualTo("BODY_TOO_LARGE");
    }

    @Test
    void aChunkedBodyUnderTheLimitStillWorks() throws Exception {
        Session s = open();
        byte[] ok = createBody(s, "Chunky").getBytes(StandardCharsets.UTF_8);

        HttpResponse<String> r = send("POST", "/api/rooms", s.cookie(), s.csrf(),
                BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(ok)));

        assertThat(r.statusCode()).isEqualTo(201);
    }
}
