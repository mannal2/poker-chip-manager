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

/** Real HTTP: replay after a lost response and the body-size limit, with cookies handled by hand. */
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
    void theSessionCookieIsNotRotatedAndALostResponseIsReplayedOnTheSameCookie() throws Exception {
        Session s = open();
        String body = createBody(s, "Alice");

        HttpResponse<String> first = send("POST", "/api/rooms", s.cookie(), s.csrf(), BodyPublishers.ofString(body));
        HttpResponse<String> again = send("POST", "/api/rooms", s.cookie(), s.csrf(), BodyPublishers.ofString(body));

        assertThat(first.statusCode()).isEqualTo(201);
        assertThat(first.headers().firstValue("Set-Cookie")).isEmpty();
        assertThat(again.statusCode()).isEqualTo(201);
        assertThat(MAPPER.readTree(again.body()).get("roomId")).isEqualTo(MAPPER.readTree(first.body()).get("roomId"));
        assertThat(MAPPER.readTree(again.body()).get("participantId"))
                .isEqualTo(MAPPER.readTree(first.body()).get("participantId"));
    }

    @Test
    void aLostJoinResponseIsReplayedToo() throws Exception {
        Session host = open();
        String code = MAPPER.readTree(send("POST", "/api/rooms", host.cookie(), host.csrf(),
                BodyPublishers.ofString(createBody(host, "Alice"))).body()).get("code").asString();
        Session guest = open();
        String body = "{\"protocolVersion\":1,\"streamId\":\"" + guest.streamId()
                + "\",\"requestId\":\"j1\",\"sequence\":1,\"code\":\"" + code + "\",\"name\":\"Bob\"}";

        HttpResponse<String> first = send("POST", "/api/room-joins", guest.cookie(), guest.csrf(),
                BodyPublishers.ofString(body));
        HttpResponse<String> again = send("POST", "/api/room-joins", guest.cookie(), guest.csrf(),
                BodyPublishers.ofString(body));

        assertThat(again.statusCode()).isEqualTo(200);
        assertThat(MAPPER.readTree(again.body()).get("participantId"))
                .isEqualTo(MAPPER.readTree(first.body()).get("participantId"));
        assertThat(MAPPER.readTree(again.body()).get("state").get("participants").size()).isEqualTo(2);
    }

    @Test
    void aBodyOfExactlyTheLimitIsAccepted() throws Exception {
        Session s = open();
        String base = createBody(s, "Exact");
        String prefix = base.substring(0, base.length() - 1) + ",\"pad\":\"";
        String suffix = "\"}";
        String body = prefix + "x".repeat(32768 - prefix.length() - suffix.length()) + suffix;
        assertThat(body.getBytes(StandardCharsets.UTF_8)).hasSize(32768);

        HttpResponse<String> r = send("POST", "/api/rooms", s.cookie(), s.csrf(), BodyPublishers.ofString(body));

        assertThat(r.statusCode()).isEqualTo(201);
    }

    @Test
    void aTruncatedChunkedBodyIsAClientErrorNotA500() throws Exception {
        Session s = open();
        try (java.net.Socket socket = new java.net.Socket("localhost", port)) {
            String head = "POST /api/rooms HTTP/1.1\r\nHost: localhost\r\nOrigin: " + ORIGIN
                    + "\r\nCookie: " + s.cookie() + "\r\nX-CSRF-TOKEN: " + s.csrf()
                    + "\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n";
            socket.getOutputStream().write((head + "100\r\nabc").getBytes(StandardCharsets.UTF_8));
            socket.shutdownOutput();
            socket.setSoTimeout(5000);
            String status = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(),
                    StandardCharsets.UTF_8)).readLine();
            assertThat(status).isNotNull().matches("HTTP/1\\.1 4\\d\\d.*");
        }
    }

    @Test
    void aDeclaredBodyOverTheLimitIsRejectedWith413() throws Exception {
        Session s = open();
        String big = createBody(s, "A").replace("\"name\"", "\"pad\":\"" + "x".repeat(40_000) + "\",\"name\"");

        HttpResponse<String> r = send("POST", "/api/rooms", s.cookie(), s.csrf(), BodyPublishers.ofString(big));

        assertThat(r.statusCode()).isEqualTo(413);
        assertThat(MAPPER.readTree(r.body()).get("code").asString()).isEqualTo("BODY_TOO_LARGE");
        assertThat(MAPPER.readTree(r.body()).get("message").asString()).isNotBlank();
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
