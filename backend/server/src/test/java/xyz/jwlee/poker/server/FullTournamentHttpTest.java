package xyz.jwlee.poker.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.server.registry.RoomRegistry;

// 실제 포트와 쿠키·CSRF·Origin으로 토너먼트 전체를 진행한다.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FullTournamentHttpTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String SPLIT = "{\"winners\":{\"pot0\":[\"p0\",\"p1\",\"p2\"]}}";

    @LocalServerPort
    int port;

    @Autowired
    RoomRegistry registry;

    private final HttpClient http = HttpClient.newHttpClient();
    private String roomId;

    // 같은 컨텍스트를 쓰는 다른 테스트의 방을 비운다.
    @BeforeEach
    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    // 세션 3개가 첫 토너먼트를 끝내고 두 번째를 시작하는 흐름을 검사한다.
    @Test
    void threeSessionsPlayATournamentToTheResultAndStartAgain() throws Exception {
        Browser alice = new Browser("alice");
        Browser bob = new Browser("bob");
        Browser carol = new Browser("carol");
        JsonNode created = alice.screen("/api/rooms", "\"name\":\"Alice\"", 201);
        roomId = created.get("roomId").asString();
        String code = created.get("code").asString();
        bob.screen("/api/room-joins", "\"code\":\"" + code + "\",\"name\":\"Bob\"", 200);
        carol.screen("/api/room-joins", "\"code\":\"" + code.toLowerCase() + "\",\"name\":\"Carol\"", 200);
        Browser[] all = {alice, bob, carol};

        alice.refusedWithoutCsrfOrWithAnotherOrigin();

        alice.command("SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}", 200);
        alice.command("SET_DEALER", "{\"participantId\":\"" + alice.participantId + "\"}", 200);
        alice.command("START", "{}", 200);
        String firstTournament = alice.state().get("tournamentId").asString();
        String firstHand = alice.state().get("game").get("hand").get("id").asString();
        assertThat(alice.state().get("roomPhase").asString()).isEqualTo("PLAYING");
        assertChips(alice, 3000);

        // 첫 핸드는 끝까지 체크해 셋이 나눈다.
        playBetting(all);
        assertThat(alice.state().get("game").get("hand").get("phase").asString()).isEqualTo("settlement");
        alice.command("SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p0\"]}}", 200);
        assertThat(carol.state().get("settlementDraft").get("draftVersion").asInt()).isEqualTo(1);
        bob.command("SETTLE_HAND", SPLIT, 403);
        alice.command("SETTLE_HAND", SPLIT, 200);
        assertThat(alice.state().get("game").get("hand").get("number").asInt()).isEqualTo(2);
        assertChips(alice, 3000);

        // 둘째 핸드는 전원 올인이고 Bob이 모두 가져가 토너먼트가 끝난다.
        actor(all).command("ALL_IN", null, 200);
        playBetting(all);
        alice.command("SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}", 200);
        JsonNode result = bob.state();
        assertThat(result.get("roomPhase").asString()).isEqualTo("RESULT");
        assertThat(result.get("game").get("players").get(1).get("stack").asInt()).isEqualTo(3000);
        assertChips(bob, 3000);
        JsonNode history = bob.get("/api/rooms/" + roomId + "/history?tournamentId=" + firstTournament, 200);
        List<String> types = new ArrayList<>();
        history.get("events").forEach(e -> types.add(e.get("type").asString()));
        assertThat(types).contains("HAND_START", "PAYOUT", "TOURNAMENT_END");

        alice.command("RE_READY", "{}", 200);
        JsonNode waiting = carol.state();
        assertThat(waiting.get("roomPhase").asString()).isEqualTo("WAITING");
        assertThat(waiting.get("tournamentId").isNull()).isTrue();
        assertThat(waiting.get("settings").get("button").asInt()).isEqualTo(-1);
        assertThat(waiting.get("participants").size()).isEqualTo(3);

        JsonNode late = alice.commandAt("CALL", null, firstTournament, firstHand, 409);
        assertThat(late.get("code").asString()).isEqualTo("TOURNAMENT_CHANGED");

        alice.command("SET_DEALER", "{\"participantId\":\"" + bob.participantId + "\"}", 200);
        alice.command("START", "{}", 200);
        JsonNode second = carol.state();
        assertThat(second.get("roomPhase").asString()).isEqualTo("PLAYING");
        assertThat(second.get("tournamentId").asString()).isNotEqualTo(firstTournament);
        assertThat(second.get("game").get("pot").asInt()).isEqualTo(15);
        assertChips(carol, 3000);
    }

    // 베팅이 끝날 때까지 차례인 사람이 콜 또는 체크한다.
    private void playBetting(Browser[] all) throws Exception {
        for (int guard = 0; guard < 30; guard++) {
            if (!"betting".equals(all[0].state().get("game").get("hand").get("phase").asString())) {
                return;
            }
            Browser actor = actor(all);
            int owed = actor.state().get("legal").get("callAdditional").asInt();
            actor.command(owed > 0 ? "CALL" : "CHECK", null, 200);
        }
        throw new AssertionError("the betting did not end");
    }

    // 현재 차례인 브라우저를 찾는다.
    private Browser actor(Browser[] all) throws Exception {
        for (Browser b : all) {
            if (!b.state().get("legal").isNull()) {
                return b;
            }
        }
        throw new AssertionError("nobody can act");
    }

    // 잔액과 팟의 합이 기대한 칩 총량인지 확인한다.
    private static void assertChips(Browser viewer, int total) throws Exception {
        JsonNode game = viewer.state().get("game");
        int sum = game.get("pot").asInt();
        for (JsonNode player : game.get("players")) {
            sum += player.get("stack").asInt();
        }
        assertThat(sum).isEqualTo(total);
    }

    // 지정한 헤더로 실제 HTTP 요청을 보낸다.
    private HttpResponse<String> send(
            String method, String path, String cookie, String csrf, String body, String origin) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .method(method, body == null ? BodyPublishers.noBody() : BodyPublishers.ofString(body))
                .header("Origin", origin).header("Content-Type", "application/json");
        if (cookie != null) {
            b.header("Cookie", cookie);
        }
        if (csrf != null) {
            b.header("X-CSRF-TOKEN", csrf);
        }
        return http.send(b.build(), BodyHandlers.ofString());
    }

    // 쿠키와 CSRF 토큰을 직접 들고 다니는 브라우저 하나를 흉내 낸다.
    private final class Browser {
        final String name;
        final String cookie;
        final String csrf;
        final String streamId;
        String participantId;
        long screenSequence;
        long commandSequence;

        // 세션과 화면 스트림을 연다.
        Browser(String name) throws Exception {
            this.name = name;
            HttpResponse<String> session = send("GET", "/api/session", null, null, null, ORIGIN);
            assertThat(session.statusCode()).isEqualTo(200);
            String setCookie = session.headers().firstValue("Set-Cookie").orElseThrow();
            assertThat(setCookie).contains("HttpOnly").containsIgnoringCase("SameSite=Lax");
            cookie = setCookie.split(";", 2)[0];
            csrf = MAPPER.readTree(session.body()).get("csrfToken").asString();
            HttpResponse<String> stream = send("POST", "/api/session/streams", cookie, csrf, "", ORIGIN);
            assertThat(stream.statusCode()).isEqualTo(200);
            streamId = MAPPER.readTree(stream.body()).get("streamId").asString();
        }

        // 생성·참가 요청을 보내고 참가자 ID를 기억한다.
        JsonNode screen(String path, String fields, int status) throws Exception {
            long n = ++screenSequence;
            String body = "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"" + name + "-s" + n
                    + "\",\"sequence\":" + n + "," + fields + "}";
            JsonNode answer = expect(send("POST", path, cookie, csrf, body, ORIGIN), status);
            participantId = answer.get("participantId").asString();
            return answer;
        }

        // CSRF 토큰 없는 요청과 다른 Origin 요청이 거절되는지 확인한다.
        void refusedWithoutCsrfOrWithAnotherOrigin() throws Exception {
            String path = "/api/rooms/" + roomId + "/commands";
            assertThat(send("POST", path, cookie, null, "{}", ORIGIN).statusCode()).isEqualTo(403);
            HttpResponse<String> foreign = send("POST", path, cookie, csrf, "{}", "https://evil.example");
            assertThat(foreign.statusCode()).isEqualTo(403);
            assertThat(MAPPER.readTree(foreign.body()).get("code").asString()).isEqualTo("ORIGIN_REJECTED");
        }

        // 최신 상태를 읽어 그 범위로 명령을 보낸다.
        JsonNode command(String type, String payload, int status) throws Exception {
            JsonNode now = state();
            JsonNode game = now.get("game");
            String tournamentId = now.get("tournamentId").isNull() ? null : now.get("tournamentId").asString();
            String handId = game.isNull() || game.get("hand").isNull() ? null : game.get("hand").get("id").asString();
            return commandAt(type, payload, tournamentId, handId, status);
        }

        // 지정한 토너먼트·핸드 범위로 명령을 보낸다.
        JsonNode commandAt(String type, String payload, String tournamentId, String handId, int status)
                throws Exception {
            long n = ++commandSequence;
            ObjectNode body = MAPPER.createObjectNode();
            body.put("protocolVersion", 1);
            body.put("requestId", name + "-c" + n);
            body.put("sequence", n);
            body.put("controlGeneration", 1);
            body.put("expectedStateVersion", state().get("stateVersion").asLong());
            body.put("type", type);
            if (tournamentId != null) {
                body.put("tournamentId", tournamentId);
            }
            if (handId != null) {
                body.put("handId", handId);
            }
            if (payload != null) {
                body.set("payload", MAPPER.readTree(payload));
            }
            return expect(send("POST", "/api/rooms/" + roomId + "/commands", cookie, csrf, body.toString(), ORIGIN),
                    status);
        }

        // 이 참가자가 보는 현재 스냅샷을 읽는다.
        JsonNode state() throws Exception {
            return get("/api/rooms/" + roomId + "/state", 200);
        }

        // 세션 쿠키로 조회한다.
        JsonNode get(String path, int status) throws Exception {
            return expect(send("GET", path, cookie, null, null, ORIGIN), status);
        }

        // 응답 코드를 확인하고 본문을 읽는다.
        private JsonNode expect(HttpResponse<String> response, int status) {
            assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
            return MAPPER.readTree(response.body());
        }
    }
}
