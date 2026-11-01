package xyz.jwlee.poker.server.auth;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.registry.RoomRegistry;

// 실제 Tomcat 세션에서 자리 없는 세션과 자리 있는 세션의 유휴 시간을 검사한다
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SessionTimeoutHttpTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String ORIGIN = "http://localhost:5173";
    private static final Map<String, HttpSession> SESSIONS = new ConcurrentHashMap<>();

    // 테스트가 서버 쪽 세션을 들여다볼 수 있게 모아 둔다
    @TestConfiguration(proxyBeanMethods = false)
    static class Sessions {
        // 만들어진 세션을 id로 기억하는 리스너를 등록한다
        @Bean
        HttpSessionListener sessionRecorder() {
            return new HttpSessionListener() {
                // 새 세션을 기억한다
                @Override
                public void sessionCreated(HttpSessionEvent event) {
                    SESSIONS.put(event.getSession().getId(), event.getSession());
                }
            };
        }
    }

    @LocalServerPort
    int port;

    @Autowired
    RoomRegistry registry;

    private final HttpClient client = HttpClient.newHttpClient();

    // 방 한도를 넘지 않도록 만든 방을 지운다
    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    // 쿠키와 CSRF 토큰과 스트림을 가진 브라우저 하나
    private record Browser(String cookie, String csrf, String streamId) {

        // 쿠키에서 세션 id만 꺼낸다
        String sessionId() {
            return cookie.split("=", 2)[1];
        }
    }

    // 새 세션과 화면 스트림을 연다
    private Browser open() throws Exception {
        HttpResponse<String> session = client.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/session")).build(),
                BodyHandlers.ofString());
        String cookie = session.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
        String csrf = MAPPER.readTree(session.body()).get("csrfToken").asString();
        String stream = post(new Browser(cookie, csrf, null), "/api/session/streams", "{}").body();
        return new Browser(cookie, csrf, MAPPER.readTree(stream).get("streamId").asString());
    }

    // 브라우저의 쿠키와 토큰으로 JSON을 보낸다
    private HttpResponse<String> post(Browser browser, String path, String json) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Cookie", browser.cookie()).header("X-CSRF-TOKEN", browser.csrf())
                .header("Origin", ORIGIN).header("Content-Type", "application/json")
                .POST(BodyPublishers.ofString(json)).build(), BodyHandlers.ofString());
    }

    // 스트림의 첫 요청 본문을 만든다
    private static String firstRequest(Browser browser, String extra) {
        return "{\"protocolVersion\":1,\"streamId\":\"" + browser.streamId()
                + "\",\"requestId\":\"s1\",\"sequence\":1" + extra + "}";
    }

    // 서버가 그 세션에 둔 유휴 시간을 돌려준다
    private static Duration idleOf(Browser browser) {
        return Duration.ofSeconds(SESSIONS.get(browser.sessionId()).getMaxInactiveInterval());
    }

    // 자리 없는 세션은 30분이고 방을 만들면 설정된 7일로 돌아간다
    @Test
    void creatingARoomRestoresTheConfiguredLifetime() throws Exception {
        Browser host = open();
        assertThat(idleOf(host)).isEqualTo(Duration.ofMinutes(30));

        assertThat(post(host, "/api/rooms", firstRequest(host, ",\"name\":\"Alice\"")).statusCode()).isEqualTo(201);

        assertThat(idleOf(host)).isEqualTo(Duration.ofDays(7));
    }

    // 참가로 자리를 받아도 설정된 7일로 돌아간다
    @Test
    void joiningRestoresTheConfiguredLifetime() throws Exception {
        Browser host = open();
        HttpResponse<String> created = post(host, "/api/rooms", firstRequest(host, ",\"name\":\"Alice\""));
        JsonNode room = MAPPER.readTree(created.body());
        Browser guest = open();

        assertThat(post(guest, "/api/room-joins", firstRequest(guest,
                ",\"code\":\"" + room.get("code").asString() + "\",\"name\":\"Bob\"")).statusCode()).isEqualTo(200);

        assertThat(idleOf(guest)).isEqualTo(Duration.ofDays(7));
    }
}
