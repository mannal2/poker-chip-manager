package xyz.jwlee.poker.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
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
import xyz.jwlee.poker.server.registry.RoomRegistry;

// 실제 포트와 쿠키·CSRF·Origin·WebSocket으로 토너먼트 전체를 진행한다.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FullTournamentHttpTest {

    private static final String ORIGIN = RealBrowser.ORIGIN;
    private static final ObjectMapper MAPPER = RealBrowser.MAPPER;
    private static final String SPLIT = "{\"winners\":{\"pot0\":[\"p0\",\"p1\",\"p2\"]}}";

    @LocalServerPort
    int port;

    @Autowired
    RoomRegistry registry;

    private final HttpClient http = HttpClient.newHttpClient();
    private final List<RealBrowser> browsers = new ArrayList<>();

    // 같은 컨텍스트를 쓰는 다른 테스트의 방을 비운다.
    @BeforeEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    // 열어 둔 소켓을 끊고 방을 비운다.
    @AfterEach
    void closeSockets() {
        browsers.forEach(b -> b.screen.abort());
        clearRooms();
    }

    // 세션과 화면 스트림을 연 브라우저를 만든다.
    private RealBrowser browser(String name) throws Exception {
        RealBrowser b = new RealBrowser(http, port, name);
        browsers.add(b);
        return b;
    }

    // 세션 3개가 소켓을 유지한 채 첫 토너먼트를 끝내고 두 번째를 시작하는 흐름을 검사한다.
    @Test
    void threeSessionsPlayATournamentToTheResultAndStartAgain() throws Exception {
        RealBrowser alice = browser("alice");
        RealBrowser bob = browser("bob");
        RealBrowser carol = browser("carol");
        String code = alice.enter("/api/rooms", "\"name\":\"Alice\"", 201).get("code").asString();
        bob.enter("/api/room-joins", "\"code\":\"" + code + "\",\"name\":\"Bob\"", 200);
        carol.enter("/api/room-joins", "\"code\":\"" + code.toLowerCase() + "\",\"name\":\"Carol\"", 200);
        RealBrowser[] all = {alice, bob, carol};

        refusedWithoutCsrfOrWithAnotherOrigin(alice);

        alice.command("SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}", 200);
        alice.command("SET_DEALER", "{\"participantId\":\"" + alice.participantId + "\"}", 200);
        alice.command("START", "{}", 200);
        String firstTournament = alice.state().get("tournamentId").asString();
        String firstHand = alice.state().get("game").get("hand").get("id").asString();
        assertThat(alice.state().get("roomPhase").asString()).isEqualTo("PLAYING");
        assertScreens(all, 3000);

        // 첫 핸드는 끝까지 체크해 셋이 나눈다.
        playBetting(all);
        assertThat(alice.state().get("game").get("hand").get("phase").asString()).isEqualTo("settlement");
        alice.command("SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p0\"]}}", 200);
        assertThat(carol.screenInSync().get("settlementDraft").get("draftVersion").asInt()).isEqualTo(1);
        bob.command("SETTLE_HAND", SPLIT, 403);
        alice.command("SETTLE_HAND", SPLIT, 200);
        assertThat(alice.state().get("game").get("hand").get("number").asInt()).isEqualTo(2);
        assertScreens(all, 3000);

        // 둘째 핸드는 전원 올인이고 Bob이 모두 가져가 토너먼트가 끝난다.
        actor(all).command("ALL_IN", null, 200);
        playBetting(all);
        alice.command("SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}", 200);
        JsonNode result = bob.screenInSync();
        assertThat(result.get("roomPhase").asString()).isEqualTo("RESULT");
        assertThat(result.get("game").get("players").get(1).get("stack").asInt()).isEqualTo(3000);
        assertScreens(all, 3000);
        JsonNode history = bob.get("/api/rooms/" + bob.roomId + "/history?tournamentId=" + firstTournament, 200);
        List<String> types = new ArrayList<>();
        history.get("events").forEach(e -> types.add(e.get("type").asString()));
        assertThat(types).contains("HAND_START", "PAYOUT", "TOURNAMENT_END");

        alice.command("RE_READY", "{}", 200);
        JsonNode waiting = carol.screenInSync();
        assertThat(waiting.get("roomPhase").asString()).isEqualTo("WAITING");
        assertThat(waiting.get("tournamentId").isNull()).isTrue();
        assertThat(waiting.get("settings").get("button").asInt()).isEqualTo(-1);
        assertThat(waiting.get("participants").size()).isEqualTo(3);

        JsonNode late = alice.commandAt("CALL", null, firstTournament, firstHand, 409);
        assertThat(late.get("code").asString()).isEqualTo("TOURNAMENT_CHANGED");

        alice.command("SET_DEALER", "{\"participantId\":\"" + bob.participantId + "\"}", 200);
        alice.command("START", "{}", 200);
        JsonNode second = carol.screenInSync();
        assertThat(second.get("roomPhase").asString()).isEqualTo("PLAYING");
        assertThat(second.get("tournamentId").asString()).isNotEqualTo(firstTournament);
        assertThat(second.get("game").get("pot").asInt()).isEqualTo(15);
        assertScreens(all, 3000);
    }

    // 베팅이 끝날 때까지 차례인 사람이 콜 또는 체크한다.
    private static void playBetting(RealBrowser[] all) throws Exception {
        for (int guard = 0; guard < 30; guard++) {
            if (!"betting".equals(all[0].state().get("game").get("hand").get("phase").asString())) {
                return;
            }
            RealBrowser actor = actor(all);
            int owed = actor.state().get("legal").get("callAdditional").asInt();
            actor.command(owed > 0 ? "CALL" : "CHECK", null, 200);
            for (RealBrowser b : all) {
                b.screenInSync();
            }
        }
        throw new AssertionError("the betting did not end");
    }

    // 현재 차례인 브라우저를 찾는다.
    private static RealBrowser actor(RealBrowser[] all) throws Exception {
        for (RealBrowser b : all) {
            if (!b.state().get("legal").isNull()) {
                return b;
            }
        }
        throw new AssertionError("nobody can act");
    }

    // 모든 화면의 마지막 SNAPSHOT이 GET state와 같고 칩 총량이 보존되는지 확인한다.
    private static void assertScreens(RealBrowser[] all, int total) throws Exception {
        for (RealBrowser b : all) {
            JsonNode game = b.screenInSync().get("game");
            int sum = game.get("pot").asInt();
            for (JsonNode player : game.get("players")) {
                sum += player.get("stack").asInt();
            }
            assertThat(sum).isEqualTo(total);
        }
    }

    // CSRF 토큰 없는 요청과 다른 Origin 요청이 거절되는지 확인한다.
    private static void refusedWithoutCsrfOrWithAnotherOrigin(RealBrowser b) throws Exception {
        String path = "/api/rooms/" + b.roomId + "/commands";
        assertThat(b.send("POST", path, b.cookie, null, "{}", ORIGIN).statusCode()).isEqualTo(403);
        HttpResponse<String> foreign = b.send("POST", path, b.cookie, b.csrf, "{}", "https://evil.example");
        assertThat(foreign.statusCode()).isEqualTo(403);
        assertThat(MAPPER.readTree(foreign.body()).get("code").asString()).isEqualTo("ORIGIN_REJECTED");
    }
}
