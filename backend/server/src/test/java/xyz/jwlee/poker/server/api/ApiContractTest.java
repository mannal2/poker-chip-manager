package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.server.support.IdGenerator;

// 응답 DTO가 없으므로 대본을 실행해 실제 요청·응답과 공유 API 예시를 필드 단위로 비교한다.
@SpringBootTest
@AutoConfigureMockMvc
@Import(ApiContractTest.Deterministic.class)
class ApiContractTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String ORIGIN = "http://localhost:5173";
    private static final String EXAMPLE_CODE = "ABC234";
    private static final String EXAMPLE_CSRF = "csrf-token-example";
    private static final AtomicLong NEXT_ID = new AtomicLong();
    private static Map<String, ObjectNode> played;

    @Autowired
    MockMvc mvc;

    private final Map<String, ObjectNode> exchanges = new TreeMap<>();
    private final List<String> csrfTokens = new ArrayList<>();
    private String roomId;
    private String roomCode;

    // ID와 시각을 고정해 예시가 실행마다 같게 만든다.
    @TestConfiguration(proxyBeanMethods = false)
    static class Deterministic {

        // 순서대로 커지는 UUID 모양 ID를 만든다.
        @Bean
        @Primary
        IdGenerator contractIds() {
            return () -> String.format("00000000-0000-4000-8000-%012d", NEXT_ID.incrementAndGet());
        }

        // 고정 시각 시계를 만든다.
        @Bean
        @Primary
        Clock contractClock() {
            return Clock.fixed(Instant.parse("2026-10-30T12:00:00Z"), ZoneOffset.UTC);
        }
    }

    // 대본을 한 번만 실행하고 요청이 있으면 예시 파일을 다시 쓴다.
    @BeforeEach
    void playOnce() throws Exception {
        if (played != null) {
            return;
        }
        NEXT_ID.set(0);
        play();
        exchanges.replaceAll((name, exchange) -> (ObjectNode) MAPPER.readTree(mask(exchange.toString())));
        played = exchanges;
    }

    // 값이 정확히 1이고 CI가 아닐 때만 재생성을 허용한다.
    static boolean regenerationAsked(String update, String ci) {
        boolean asked = "1".equals(update);
        if (asked && ci != null) {
            throw new AssertionError("UPDATE_API_CONTRACT is refused when CI is set");
        }
        return asked;
    }

    // 예시 파일을 실제 교환으로 다시 쓴다.
    private static void writeExamples() throws IOException {
        Files.createDirectories(directory());
        for (Map.Entry<String, ObjectNode> e : played.entrySet()) {
            String text = MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(e.getValue()) + "\n";
            Files.writeString(directory().resolve(e.getKey() + ".json"), text);
        }
    }

    // 모든 예시 파일이 대본의 실제 요청·응답과 같은지 확인한다.
    @Test
    void everyExampleIsWhatTheServerReallyAnswers() throws Exception {
        if (regenerationAsked(System.getenv("UPDATE_API_CONTRACT"), System.getenv("CI"))) {
            writeExamples();
            throw new AssertionError("examples regenerated, review and rerun");
        }
        assertThat(exampleNames()).isEqualTo(new TreeSet<>(played.keySet()));
        List<String> differences = new ArrayList<>();
        for (Map.Entry<String, ObjectNode> e : played.entrySet()) {
            differences(e.getKey(), example(e.getKey()), e.getValue(), differences);
        }
        assertThat(differences).isEmpty();
    }

    // 재생성 요청 값은 정확히 1만 인정하고 CI에서는 거절하는지 확인한다.
    @Test
    void onlyAnExactOneOutsideCiRegenerates() {
        assertThat(regenerationAsked("1", null)).isTrue();
        assertThat(regenerationAsked("true", null)).isFalse();
        assertThat(regenerationAsked(null, "true")).isFalse();
        assertThatThrownBy(() -> regenerationAsked("1", "true")).isInstanceOf(AssertionError.class);
    }

    // 필드가 빠진 예시를 비교기가 잡아내는지 확인한다.
    @Test
    void aMissingFieldIsCaught() throws Exception {
        ObjectNode broken = example("command-applied").deepCopy();
        ((ObjectNode) broken.get("response")).remove("resultStateVersion");

        assertThat(compare(broken, example("command-applied"))).singleElement().asString()
                .contains("resultStateVersion").contains("missing");
    }

    // 이름이 틀린 필드를 비교기가 잡아내는지 확인한다.
    @Test
    void aRenamedFieldIsCaught() throws Exception {
        ObjectNode broken = example("control-applied").deepCopy();
        ObjectNode response = (ObjectNode) broken.get("response");
        response.set("controlGen", response.remove("controlGeneration"));

        assertThat(compare(broken, example("control-applied"))).hasSize(2);
    }

    // 타입이 바뀐 필드를 비교기가 잡아내는지 확인한다.
    @Test
    void aChangedTypeIsCaught() throws Exception {
        ObjectNode broken = example("snapshot-waiting").deepCopy();
        ((ObjectNode) broken.get("response")).put("stateVersion", "2");

        assertThat(compare(broken, example("snapshot-waiting"))).singleElement().asString().contains("type");
    }

    // 세션부터 결과·조작 인수까지 예시로 남길 교환을 실행한다.
    private void play() throws Exception {
        Browser alice = new Browser("session", "stream");
        Browser bob = new Browser(null, null);
        JsonNode created = alice.screen("create-room", 201, "/api/rooms", "\"name\":\"Alice\"");
        roomId = created.get("roomId").asString();
        roomCode = created.get("code").asString();
        bob.screen("join-room", 200, "/api/room-joins", "\"code\":\"" + roomCode + "\",\"name\":\"Bob\"");

        alice.command(null, 200, "SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}");
        alice.command(null, 200, "SET_DEALER", "{\"participantId\":\"" + alice.participantId + "\"}");
        alice.snapshot("snapshot-waiting");
        alice.command(null, 200, "START", "{}");
        JsonNode playing = alice.snapshot("snapshot-playing");
        assertThat(playing.get("legal").isNull()).isFalse();

        alice.commandAt("command-rejected", 409, "ALL_IN", null, playing.get("stateVersion").asLong() - 1, playing);
        String applied = alice.command("command-applied", 200, "ALL_IN", null);
        alice.call("request-result", 200, HttpMethod.GET, "/api/rooms/{roomId}/requests/{requestId}", applied, null);
        bob.command(null, 200, "CALL", null);

        alice.command(null, 200, "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p0\"]}}");
        assertThat(alice.snapshot("snapshot-settlement").get("settlementDraft").isNull()).isFalse();
        alice.command(null, 200, "SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p0\"]}}");
        JsonNode result = alice.snapshot("snapshot-result");
        assertThat(result.get("roomPhase").asString()).isEqualTo("RESULT");
        alice.call("history", 200, HttpMethod.GET,
                "/api/rooms/{roomId}/history?tournamentId=" + result.get("tournamentId").asString() + "&after=0&limit=50",
                null, null);

        bob.control("control-applied", 200, 1);
        bob.control("control-lost", 409, 1);
        bob.commandAt("command-control-lost", 409, "CHECK", null, result.get("stateVersion").asLong(), result);
        alice.commandSequence++;
        alice.commandAt("command-sequence-gap", 409, "UNDO", "{}", result.get("stateVersion").asLong(), result);
        alice.origin = "https://evil.example";
        alice.screen("error-origin-rejected", 403, "/api/rooms", "\"name\":\"Mallory\"");
        new Browser(null, null).call("error-not-found", 404, HttpMethod.GET, "/api/rooms/{roomId}/state", null, null);
    }

    // 교환 하나를 예시 형태로 저장한다.
    private void record(String name, HttpMethod method, String path, int status, String body, String answer) {
        ObjectNode exchange = MAPPER.createObjectNode();
        exchange.put("method", method.name());
        exchange.put("path", path);
        exchange.put("status", status);
        exchange.set("request", body == null ? MAPPER.nullNode() : MAPPER.readTree(body));
        exchange.set("response", MAPPER.readTree(answer));
        exchanges.put(name, exchange);
    }

    // 실행마다 달라지는 방 코드와 CSRF 토큰을 고정값으로 바꾼다.
    private String mask(String text) {
        String out = text.replace(roomCode, EXAMPLE_CODE);
        for (String token : csrfTokens) {
            out = out.replace(token, EXAMPLE_CSRF);
        }
        return out;
    }

    // 두 JSON의 차이를 경로별 목록으로 돌려준다.
    private static List<String> compare(JsonNode expected, JsonNode actual) {
        List<String> out = new ArrayList<>();
        differences("$", expected, actual, out);
        return out;
    }

    // 필드 누락·이름·타입·값 차이를 재귀로 모은다.
    private static void differences(String path, JsonNode expected, JsonNode actual, List<String> out) {
        if (expected.getNodeType() != actual.getNodeType()) {
            out.add(path + ": type " + expected.getNodeType() + " vs " + actual.getNodeType());
        } else if (expected.isObject()) {
            Set<String> names = new TreeSet<>(expected.propertyNames());
            names.addAll(actual.propertyNames());
            for (String name : names) {
                String child = path + "." + name;
                if (!actual.has(name)) {
                    out.add(child + ": missing from the server's answer");
                } else if (!expected.has(name)) {
                    out.add(child + ": missing from the example");
                } else {
                    differences(child, expected.get(name), actual.get(name), out);
                }
            }
        } else if (expected.isArray()) {
            if (expected.size() != actual.size()) {
                out.add(path + ": length " + expected.size() + " vs " + actual.size());
                return;
            }
            for (int i = 0; i < expected.size(); i++) {
                differences(path + "[" + i + "]", expected.get(i), actual.get(i), out);
            }
        } else if (!expected.equals(actual)) {
            out.add(path + ": value " + expected + " vs " + actual);
        }
    }

    // 예시 폴더 위치를 찾는다.
    private static Path directory() {
        String configured = System.getProperty("contract.dir");
        return (configured != null ? Path.of(configured) : Path.of("..", "..", "shared", "api-contract"))
                .toAbsolutePath().normalize();
    }

    // 폴더의 예시 이름을 모은다.
    private static Set<String> exampleNames() throws IOException {
        try (Stream<Path> files = Files.list(directory())) {
            Set<String> names = new TreeSet<>();
            files.map(p -> p.getFileName().toString()).filter(n -> n.endsWith(".json"))
                    .forEach(n -> names.add(n.substring(0, n.length() - ".json".length())));
            return names;
        }
    }

    // 예시 파일 하나를 읽는다.
    private static ObjectNode example(String name) throws IOException {
        return (ObjectNode) MAPPER.readTree(Files.readString(directory().resolve(name + ".json")));
    }

    // 세션 하나로 요청을 보내고 지정한 교환을 기록한다.
    private final class Browser {
        final MockHttpSession session;
        final String csrf;
        final String streamId;
        String participantId;
        String origin = ORIGIN;
        long screenSequence;
        long commandSequence;

        // 세션과 화면 스트림을 열고 필요하면 예시로 남긴다.
        Browser(String sessionExample, String streamExample) throws Exception {
            MvcResult opened = mvc.perform(request(HttpMethod.GET, "/api/session")).andReturn();
            session = (MockHttpSession) opened.getRequest().getSession(false);
            String answer = opened.getResponse().getContentAsString(StandardCharsets.UTF_8);
            csrf = MAPPER.readTree(answer).get("csrfToken").asString();
            csrfTokens.add(csrf);
            if (sessionExample != null) {
                record(sessionExample, HttpMethod.GET, "/api/session", opened.getResponse().getStatus(), null, answer);
            }
            streamId = call(streamExample, 200, HttpMethod.POST, "/api/session/streams", null, null)
                    .get("streamId").asString();
        }

        // 생성·참가 요청을 보낸다.
        JsonNode screen(String example, int status, String path, String fields) throws Exception {
            JsonNode answer = call(example, status, HttpMethod.POST, path, null, screenBody(fields));
            if (answer.has("participantId")) {
                participantId = answer.get("participantId").asString();
            }
            return answer;
        }

        // 조작 화면 인수 요청을 보낸다.
        void control(String example, int status, long expected) throws Exception {
            String body = screenBody("\"expectedControlGeneration\":" + expected);
            call(example, status, HttpMethod.POST, "/api/rooms/{roomId}/control", null, body);
        }

        // 화면 스트림의 다음 순번을 담은 요청 본문을 만든다.
        private String screenBody(String fields) {
            long n = ++screenSequence;
            return "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"screen-" + n
                    + "\",\"sequence\":" + n + "," + fields + "}";
        }

        // 최신 상태 기준의 명령을 보내고 requestId를 돌려준다.
        String command(String example, int status, String type, String payload) throws Exception {
            JsonNode now = call(null, 200, HttpMethod.GET, "/api/rooms/{roomId}/state", null, null);
            return commandAt(example, status, type, payload, now.get("stateVersion").asLong(), now);
        }

        // 기대 버전을 지정해 세대 1의 명령을 보낸다.
        String commandAt(String example, int status, String type, String payload, long version, JsonNode now)
                throws Exception {
            long n = ++commandSequence;
            String requestId = "command-" + participantId.substring(participantId.length() - 2) + "-" + n;
            ObjectNode body = MAPPER.createObjectNode();
            body.put("protocolVersion", 1);
            body.put("requestId", requestId);
            body.put("sequence", n);
            body.put("controlGeneration", 1);
            body.put("expectedStateVersion", version);
            body.put("type", type);
            if (!now.get("tournamentId").isNull()) {
                body.put("tournamentId", now.get("tournamentId").asString());
            }
            JsonNode game = now.get("game");
            if (!game.isNull() && !game.get("hand").isNull()) {
                body.put("handId", game.get("hand").get("id").asString());
            }
            if (payload != null) {
                body.set("payload", MAPPER.readTree(payload));
            }
            call(example, status, HttpMethod.POST, "/api/rooms/{roomId}/commands", null, body.toString());
            return requestId;
        }

        // 상태를 읽어 스냅샷 예시로 남긴다.
        JsonNode snapshot(String example) throws Exception {
            return call(example, 200, HttpMethod.GET, "/api/rooms/{roomId}/state", null, null);
        }

        // 요청을 보내 응답 코드를 확인하고 기록한다.
        JsonNode call(String example, int status, HttpMethod method, String template, String requestId, String body)
                throws Exception {
            String path = template.replace("{roomId}", String.valueOf(roomId))
                    .replace("{requestId}", String.valueOf(requestId));
            MockHttpServletRequestBuilder builder = request(method, path).session(session);
            if (method == HttpMethod.POST) {
                builder.header("X-CSRF-TOKEN", csrf).header("Origin", origin);
            }
            if (body != null) {
                builder.contentType(MediaType.APPLICATION_JSON).content(body);
            }
            MockHttpServletResponse response = mvc.perform(builder).andReturn().getResponse();
            String answer = response.getContentAsString(StandardCharsets.UTF_8);
            assertThat(response.getStatus()).as(path + " " + answer).isEqualTo(status);
            if (example != null) {
                record(example, method, template, status, body, answer);
            }
            return MAPPER.readTree(answer);
        }
    }
}
