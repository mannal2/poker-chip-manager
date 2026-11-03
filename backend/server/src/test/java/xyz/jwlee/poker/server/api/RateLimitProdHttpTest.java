package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse.BodyHandlers;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

// 운영 프로필의 실제 Tomcat에서 프록시 IP와 경로 표기를 검사한다
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "poker.rate-limit.enabled=true")
@ActiveProfiles("prod")
class RateLimitProdHttpTest {

    @LocalServerPort
    int port;

    private final HttpClient client = HttpClient.newHttpClient();

    // 프록시가 넘긴 주소로 POST를 보내고 상태 코드를 돌려준다
    private int post(String rawPath, String realIp) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + rawPath))
                .header("X-Real-IP", realIp).POST(BodyPublishers.noBody()).build(), BodyHandlers.ofString())
                .statusCode();
    }

    // 운영에서는 X-Real-IP별로 버킷이 나뉜다
    @Test
    void prodCountsTheAddressTheProxyReports() throws Exception {
        for (int i = 0; i < 5; i++) {
            assertThat(post("/api/rooms", "203.0.113.1")).isNotEqualTo(429);
        }

        assertThat(post("/api/rooms", "203.0.113.1")).isEqualTo(429);
        assertThat(post("/api/rooms", "203.0.113.2")).isNotEqualTo(429);
    }

    // 퍼센트 인코딩한 경로도 같은 대상으로 세어 우회할 수 없다
    @Test
    void anEncodedPathCannotSkipTheLimit() throws Exception {
        for (int i = 0; i < 5; i++) {
            post("/api/rooms", "203.0.113.3");
        }

        assertThat(post("/api/%72ooms", "203.0.113.3")).isEqualTo(429);
    }
}
