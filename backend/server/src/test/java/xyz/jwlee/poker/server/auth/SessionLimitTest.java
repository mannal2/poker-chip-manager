package xyz.jwlee.poker.server.auth;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.http.HttpSessionEvent;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.mock.web.MockHttpSession;
import tools.jackson.databind.ObjectMapper;

// 실제 Tomcat 세션으로 서버 전체 세션 한도를 검사한다
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "poker.rate-limit.max-sessions=3")
class SessionLimitTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @LocalServerPort
    int port;

    @Autowired
    SessionLimitListener limit;

    private final HttpClient client = HttpClient.newHttpClient();

    // 쿠키를 붙이거나 붙이지 않고 세션을 조회한다
    private HttpResponse<String> session(String cookie) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/session"));
        if (cookie != null) {
            request.header("Cookie", cookie);
        }
        return client.send(request.build(), BodyHandlers.ofString());
    }

    // 응답의 쿠키에서 이름과 값만 꺼낸다
    private static String cookieOf(HttpResponse<String> response) {
        return response.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
    }

    // 한도를 넘은 새 세션만 503이고 기존 세션은 계속 쓰며 세션이 끝나면 자리가 돌아온다
    @Test
    void theFourthNewSessionIsRefusedAndExistingOnesStay() throws Exception {
        String[] cookies = new String[3];
        String csrf = null;
        for (int i = 0; i < 3; i++) {
            HttpResponse<String> opened = session(null);
            assertThat(opened.statusCode()).isEqualTo(200);
            cookies[i] = cookieOf(opened);
            csrf = MAPPER.readTree(opened.body()).get("csrfToken").asString();
        }

        HttpResponse<String> refused = session(null);

        assertThat(refused.statusCode()).isEqualTo(503);
        assertThat(MAPPER.readTree(refused.body()).get("code").asString()).isEqualTo("SESSION_LIMIT");
        assertThat(refused.headers().firstValue("Retry-After")).contains("60");
        assertThat(refused.headers().firstValue("Set-Cookie")).isEmpty();

        assertThat(session(cookies[0]).statusCode()).isEqualTo(200);
        int stream = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/session/streams"))
                .header("Cookie", cookies[2]).header("X-CSRF-TOKEN", csrf)
                .header("Origin", "http://localhost:5173").POST(BodyPublishers.noBody()).build(),
                BodyHandlers.ofString()).statusCode();
        assertThat(stream).isEqualTo(200);

        limit.sessionDestroyed(new HttpSessionEvent(new MockHttpSession()));
        assertThat(session(null).statusCode()).isEqualTo(200);
    }
}
