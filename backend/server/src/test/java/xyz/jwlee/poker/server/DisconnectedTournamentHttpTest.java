package xyz.jwlee.poker.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.MutableClock;

// 실제 소켓과 실제 예약 작업(방 점검, 생존 확인)으로 끊김이 있는 토너먼트를 끝까지 진행한다
/**
 * The sweep and the heartbeat are not called from here: only the clock moves, and the real scheduled tasks react
 * within their one-second tick. A silent socket closed by the heartbeat and a takeover request opened by the sweep
 * are therefore proof that those tasks really run.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "poker.sweep.enabled=true")
@Import(DisconnectedTournamentHttpTest.MovableTime.class)
class DisconnectedTournamentHttpTest {

    private static final Duration PING_INTERVAL = Duration.ofSeconds(15);
    private static final String SPLIT_BOB_CAROL = "{\"winners\":{\"pot0\":[\"p1\",\"p2\"]}}";
    private static final int TOTAL_CHIPS = 3000;

    // 테스트가 진행시키는 시계로 서버 시계를 바꾼다
    @TestConfiguration(proxyBeanMethods = false)
    static class MovableTime {

        // 테스트가 직접 진행시키는 시계를 만든다
        @Bean
        @Primary
        MutableClock movableClock() {
            return new MutableClock(Instant.parse("2026-10-31T12:00:00Z"));
        }
    }

    @LocalServerPort
    int port;

    @Autowired
    RoomRegistry registry;

    @Autowired
    MutableClock clock;

    private final HttpClient http = HttpClient.newHttpClient();
    private final List<RealBrowser> browsers = new ArrayList<>();

    // 열어 둔 소켓을 끊고 방을 비운다
    @AfterEach
    void closeSockets() {
        browsers.forEach(b -> b.screen.abort());
        registry.roomIds().forEach(registry::remove);
    }

    // 세 사람이 소켓을 연 채 토너먼트를 시작한다. 첫 차례는 Alice다
    private RealBrowser[] startedGame() throws Exception {
        RealBrowser alice = browser("alice");
        RealBrowser bob = browser("bob");
        RealBrowser carol = browser("carol");
        String code = alice.enter("/api/rooms", "\"name\":\"Alice\"", 201).get("code").asString();
        bob.enter("/api/room-joins", "\"code\":\"" + code + "\",\"name\":\"Bob\"", 200);
        carol.enter("/api/room-joins", "\"code\":\"" + code + "\",\"name\":\"Carol\"", 200);
        alice.command("SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}", 200);
        alice.command("SET_DEALER", "{\"participantId\":\"" + alice.participantId + "\"}", 200);
        alice.command("START", "{}", 200);
        return new RealBrowser[] {alice, bob, carol};
    }

    // 세션과 화면 스트림을 연 브라우저를 만든다
    private RealBrowser browser(String name) throws Exception {
        RealBrowser b = new RealBrowser(http, port, name);
        browsers.add(b);
        return b;
    }

    // 시계를 15초씩 돌리며 응답하는 화면마다 실제 PING을 받아 답할 때까지 기다린다
    private void passTime(Duration length, RealBrowser... responding) {
        for (Duration left = length; left.isPositive(); left = left.minus(PING_INTERVAL)) {
            int[] before = new int[responding.length];
            for (int i = 0; i < responding.length; i++) {
                before[i] = responding[i].screen.pongs.get();
            }
            clock.advance(PING_INTERVAL);
            for (int i = 0; i < responding.length; i++) {
                int index = i;
                await().atMost(RealBrowser.WAIT)
                        .until(() -> responding[index].screen.pongs.get() > before[index]);
            }
        }
    }

    // 주어진 사람의 차례가 올 때까지 다른 사람이 콜 또는 체크한다
    private static void playUntilTurnOf(RealBrowser wanted, RealBrowser[] others) throws Exception {
        for (int guard = 0; guard < 30; guard++) {
            if (!wanted.state().get("legal").isNull()) {
                return;
            }
            RealBrowser actor = actor(others);
            actor.command(callOrCheck(actor), null, 200);
        }
        throw new AssertionError(wanted.name + " never got the turn");
    }

    // 정산 단계가 될 때까지 차례인 사람이 콜 또는 체크한다
    private static void playToSettlement(RealBrowser... players) throws Exception {
        for (int guard = 0; guard < 30; guard++) {
            if ("settlement".equals(players[0].state().get("game").get("hand").get("phase").asString())) {
                return;
            }
            RealBrowser actor = actor(players);
            actor.command(callOrCheck(actor), null, 200);
        }
        throw new AssertionError("the betting did not end");
    }

    // 현재 차례인 브라우저를 찾는다
    private static RealBrowser actor(RealBrowser[] players) throws Exception {
        for (RealBrowser b : players) {
            if (!b.state().get("legal").isNull()) {
                return b;
            }
        }
        throw new AssertionError("nobody here can act");
    }

    // 낼 금액이 있으면 콜, 없으면 체크를 고른다
    private static String callOrCheck(RealBrowser actor) throws Exception {
        return actor.state().get("legal").get("callAdditional").asInt() > 0 ? "CALL" : "CHECK";
    }

    // 스냅샷의 잔액과 팟의 합이 처음 칩 총량인지 확인한다
    private static void assertChipsKept(JsonNode state) {
        JsonNode game = state.get("game");
        int sum = game.get("pot").asInt();
        for (JsonNode player : game.get("players")) {
            sum += player.get("stack").asInt();
        }
        assertThat(sum).isEqualTo(TOTAL_CHIPS);
    }

    // 화면들이 최신 상태까지 따라왔는지 확인해 끊기기 전 스냅샷이 판정에 쓰이지 않게 한다
    private static void syncScreens(RealBrowser... screens) throws Exception {
        for (RealBrowser b : screens) {
            b.screenInSync();
        }
    }

    // 응답 없는 사람을 생존 확인이 끊고 자동 폴드한 뒤 돌아와 직접 행동하는 흐름을 검사한다
    @Test
    void aSilentPlayerIsPlayedForByTheServerAndComesBackToActThemselves() throws Exception {
        RealBrowser[] all = startedGame();
        RealBrowser alice = all[0];
        RealBrowser bob = all[1];
        RealBrowser carol = all[2];
        playUntilTurnOf(bob, new RealBrowser[] {alice, carol});
        String tournamentId = alice.state().get("tournamentId").asString();
        syncScreens(all);

        bob.screen.goSilent();
        passTime(Duration.ofSeconds(45), alice, carol);

        assertThat(bob.screen.awaitClosed()).isEqualTo(1000);
        alice.screen.awaitState(s -> bob.absentIn(s)
                && !"p1".equals(s.get("game").get("hand").get("actorId").asString()));
        assertThat(alice.history(tournamentId, e -> e.get("details").path("auto").asBoolean(false)))
                .singleElement().satisfies(e -> {
                    assertThat(e.get("details").get("playerId").asString()).isEqualTo("p1");
                    assertThat(e.get("type").asString()).isEqualTo("FOLD");
                });

        bob.subscribe();
        assertThat(alice.screen.awaitState(bob::connectedIn).get("game").get("hand").get("number").asInt())
                .isEqualTo(1);
        playToSettlement(alice, carol);
        alice.command("SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p0\"]}}", 200);

        playUntilTurnOf(bob, new RealBrowser[] {alice, carol});
        bob.command(callOrCheck(bob), null, 200);

        JsonNode shown = bob.screenInSync();
        assertThat(shown.get("game").get("hand").get("number").asInt()).isEqualTo(2);
        assertThat(bob.history(tournamentId, e -> e.get("details").has("additional"))).last().satisfies(e -> {
            assertThat(e.get("details").get("playerId").asString()).isEqualTo("p1");
            assertThat(e.get("details").has("auto")).isFalse();
        });
        assertChipsKept(shown);
    }

    // 끊긴 방장을 방 점검이 인수 요청으로 알리고 전 방장이 일반 참가자로 돌아오는 흐름을 검사한다
    @Test
    void aGoneHostIsReplacedAndComesBackAsAnOrdinaryPlayer() throws Exception {
        RealBrowser[] all = startedGame();
        RealBrowser alice = all[0];
        RealBrowser bob = all[1];
        RealBrowser carol = all[2];
        syncScreens(all);

        alice.screen.abort();
        bob.screen.awaitState(alice::absentIn);
        carol.screen.awaitState(alice::absentIn);
        passTime(Duration.ofSeconds(60), bob, carol);

        JsonNode asked = bob.screen.awaitState(s -> s.get("hostTakeoverOpen").asBoolean());
        assertThat(asked.get("you").get("canTakeHost").asBoolean()).isTrue();
        bob.command("TAKE_HOST", "{}", 200);
        JsonNode replaced = carol.screen.awaitState(s -> s.get("hostId").asString().equals(bob.participantId));
        assertThat(replaced.get("hostTakeoverOpen").asBoolean()).isFalse();

        alice.subscribe();
        JsonNode back = alice.screenInSync();
        assertThat(back.get("hostId").asString()).isEqualTo(bob.participantId);
        assertThat(alice.connectedIn(back)).isTrue();
        assertThat(back.get("you").get("canTakeHost").asBoolean()).isFalse();

        playToSettlement(bob, carol);
        assertThat(alice.state().get("you").get("capabilities").get("canSettle").asBoolean()).isFalse();
        alice.command("SETTLE_HAND", SPLIT_BOB_CAROL, 403);
        bob.command("SETTLE_HAND", SPLIT_BOB_CAROL, 200);

        playUntilTurnOf(alice, new RealBrowser[] {bob, carol});
        alice.command(callOrCheck(alice), null, 200);
        assertChipsKept(alice.screenInSync());
    }

    // 접속 중인 사람은 거절하고 끊긴 사람을 기권 처리해 토너먼트를 끝내는 흐름을 검사한다
    @Test
    void forfeitingTheDisconnectedEndsTheTournament() throws Exception {
        RealBrowser[] all = startedGame();
        RealBrowser alice = all[0];
        RealBrowser bob = all[1];
        RealBrowser carol = all[2];
        String forfeitBob = "{\"participantId\":\"" + bob.participantId + "\"}";
        String forfeitCarol = "{\"participantId\":\"" + carol.participantId + "\"}";

        JsonNode refused = alice.command("FORFEIT_DISCONNECTED", forfeitBob, 422);
        assertThat(refused.get("code").asString()).isEqualTo("TARGET_CONNECTED");

        syncScreens(alice);
        bob.screen.abort();
        carol.screen.abort();
        alice.screen.awaitState(s -> bob.absentIn(s) && carol.absentIn(s));
        alice.command("FORFEIT_DISCONNECTED", forfeitBob, 200);
        alice.command("FORFEIT_DISCONNECTED", forfeitCarol, 200);

        JsonNode result = alice.screenInSync();
        assertThat(result.get("roomPhase").asString()).isEqualTo("RESULT");
        assertThat(result.get("game").get("players").get(0).get("stack").asInt()).isEqualTo(TOTAL_CHIPS);
        assertChipsKept(result);
        assertThat(alice.history(result.get("tournamentId").asString(), e -> e.get("type").asString().equals("FORFEIT")))
                .hasSize(2).allSatisfy(e -> assertThat(e.get("details").get("byHost").asBoolean()).isTrue());
    }
}
