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
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("prod")
class ProdProfileHttpTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @LocalServerPort
    int port;

    private final HttpClient client = HttpClient.newHttpClient();

    @Test
    void prodCookieIsHostPrefixedSecureAndOnlyTheProdOriginIsAllowed() throws Exception {
        HttpResponse<String> r = client.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/session")).build(),
                BodyHandlers.ofString());
        String setCookie = r.headers().firstValue("Set-Cookie").orElseThrow();

        assertThat(setCookie).startsWith("__Host-pcm-session=").contains("Path=/").contains("Secure")
                .containsIgnoringCase("HttpOnly").containsIgnoringCase("SameSite=Lax").contains("Max-Age=604800")
                .doesNotContainIgnoringCase("Domain=");

        String cookie = setCookie.split(";", 2)[0];
        String csrf = MAPPER.readTree(r.body()).get("csrfToken").asString();
        assertThat(post(cookie, csrf, "https://pcm.jwlee.xyz")).isEqualTo(200);
        assertThat(post(cookie, csrf, "http://localhost:5173")).isEqualTo(403);
    }

    private int post(String cookie, String csrf, String origin) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/session/streams"))
                .header("Cookie", cookie).header("X-CSRF-TOKEN", csrf).header("Origin", origin)
                .POST(BodyPublishers.noBody()).build(), BodyHandlers.ofString()).statusCode();
    }
}
