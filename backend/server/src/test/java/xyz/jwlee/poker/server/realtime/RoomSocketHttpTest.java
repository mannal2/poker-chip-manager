package xyz.jwlee.poker.server.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;
import static org.awaitility.Awaitility.await;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Predicate;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.springframework.web.servlet.function.RouterFunction;
import org.springframework.web.servlet.function.RouterFunctions;
import org.springframework.web.servlet.function.ServerResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomTestAccess;

// 실제 포트와 쿠키로 /ws의 핸드셰이크, 구독, 전송, 닫힘을 검사한다
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RoomSocketHttpTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Duration WAIT = Duration.ofSeconds(5);
    private static final int MAX_INBOUND_BYTES = 4096;

    // 세션을 곧바로 무효화하는 테스트 전용 경로를 더한다
    @TestConfiguration
    static class ExpireSession {
        @Bean
        RouterFunction<ServerResponse> expireSessionRoute() {
            return RouterFunctions.route().GET("/test/expire-session", request -> {
                request.servletRequest().getSession().invalidate();
                return ServerResponse.noContent().build();
            }).build();
        }
    }

    @LocalServerPort
    int port;

    @Autowired
    RoomRegistry registry;

    @Autowired
    ConnectionHub hub;

    @Autowired
    Clock clock;

    @Autowired
    ScheduledTaskHolder scheduled;

    private final HttpClient http = HttpClient.newHttpClient();
    private final List<Screen> screens = new ArrayList<>();

    // 같은 컨텍스트를 쓰는 다른 테스트의 방을 비운다
    @BeforeEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    // 열어 둔 소켓을 끊고 서버가 정리를 끝낼 때까지 기다린다
    @AfterEach
    void closeSockets() {
        screens.forEach(Screen::abort);
        await().atMost(WAIT).until(() -> hub.connections().isEmpty());
        registry.roomIds().forEach(registry::remove);
    }

    // 지정한 헤더로 HTTP 요청을 보낸다
    private HttpResponse<String> send(String method, String path, String cookie, String csrf, String body)
            throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .method(method, body == null ? BodyPublishers.noBody() : BodyPublishers.ofString(body))
                .header("Origin", ORIGIN).header("Content-Type", "application/json");
        if (cookie != null) {
            b.header("Cookie", cookie);
        }
        if (csrf != null) {
            b.header("X-CSRF-TOKEN", csrf);
        }
        return http.send(b.build(), BodyHandlers.ofString());
    }

    // 소켓을 열고 핸드셰이크 결과를 돌려준다
    private CompletableFuture<WebSocket> dial(String cookie, String origin, Screen listener) {
        WebSocket.Builder b = http.newWebSocketBuilder();
        if (cookie != null) {
            b.header("Cookie", cookie);
        }
        if (origin != null) {
            b.header("Origin", origin);
        }
        return b.buildAsync(URI.create("ws://localhost:" + port + "/ws"), listener);
    }

    // 거절되는 핸드셰이크의 HTTP 상태를 돌려준다
    private int refusedStatus(String cookie, String origin) throws Exception {
        try {
            dial(cookie, origin, new Screen()).get(WAIT.toSeconds(), TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            if (e.getCause() instanceof WebSocketHandshakeException refused) {
                return refused.getResponse().statusCode();
            }
            throw e;
        }
        return fail("the handshake was accepted");
    }

    // 소켓 하나를 흉내 내며 받은 메시지와 닫기 코드를 기록한다
    private static final class Screen implements WebSocket.Listener {
        final BlockingQueue<JsonNode> inbox = new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed = new CompletableFuture<>();
        private final StringBuilder partial = new StringBuilder();
        private WebSocket socket;

        @Override
        public void onOpen(WebSocket webSocket) {
            socket = webSocket;
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            partial.append(data);
            if (last) {
                inbox.add(MAPPER.readTree(partial.toString()));
                partial.setLength(0);
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            closed.complete(statusCode);
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            closed.complete(-1);
        }

        // 조건에 맞는 메시지가 올 때까지 기다리며 PING은 건너뛴다
        JsonNode next(Predicate<JsonNode> wanted) throws Exception {
            long deadline = System.nanoTime() + WAIT.toNanos();
            while (true) {
                JsonNode m = inbox.poll(deadline - System.nanoTime(), TimeUnit.NANOSECONDS);
                if (m == null) {
                    return fail("no matching message arrived");
                }
                if (wanted.test(m)) {
                    return m;
                }
            }
        }

        // 지정한 종류의 메시지를 기다린다
        JsonNode next(String type) throws Exception {
            return next(m -> m.get("type").asString().equals(type));
        }

        // 지정한 버전 이후의 스냅샷을 기다린다
        JsonNode snapshotAfter(long version) throws Exception {
            return next(m -> m.get("type").asString().equals("SNAPSHOT")
                    && m.get("state").get("stateVersion").asLong() > version);
        }

        // 텍스트 프레임 하나를 보낸다
        void say(String text) throws Exception {
            socket.sendText(text, true).get(WAIT.toSeconds(), TimeUnit.SECONDS);
        }

        // 서버가 연결을 닫을 때까지 기다리고 코드를 돌려준다
        int awaitClosed() throws Exception {
            return closed.get(WAIT.toSeconds(), TimeUnit.SECONDS);
        }

        // 닫기 절차 없이 끊는다
        void abort() {
            if (socket != null) {
                socket.abort();
            }
        }

        // 정상 닫기를 보낸다
        void hangUp() throws Exception {
            socket.sendClose(WebSocket.NORMAL_CLOSURE, "").get(WAIT.toSeconds(), TimeUnit.SECONDS);
        }
    }

    // 쿠키·CSRF·스트림을 들고 다니는 브라우저 하나를 흉내 낸다
    private final class Browser {
        final String name;
        final String cookie;
        final String csrf;
        final String streamId;
        String roomId;
        String code;
        String participantId;
        long sequence;
        long streamSequence;

        Browser(String name) throws Exception {
            this.name = name;
            HttpResponse<String> session = send("GET", "/api/session", null, null, null);
            cookie = session.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
            csrf = MAPPER.readTree(session.body()).get("csrfToken").asString();
            streamId = MAPPER.readTree(send("POST", "/api/session/streams", cookie, csrf, "").body())
                    .get("streamId").asString();
        }

        // 방을 만들거나 코드로 참가한다
        Browser enter(String path, String fields) throws Exception {
            long n = ++streamSequence;
            JsonNode answer = MAPPER.readTree(send("POST", path, cookie, csrf,
                    "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"" + name + "-s" + n
                            + "\",\"sequence\":" + n + "," + fields + "}").body());
            roomId = answer.get("roomId").asString();
            code = answer.get("code").asString();
            participantId = answer.get("participantId").asString();
            return this;
        }

        // 새 소켓을 연다
        Screen open() throws Exception {
            Screen screen = new Screen();
            dial(cookie, ORIGIN, screen).get(WAIT.toSeconds(), TimeUnit.SECONDS);
            screens.add(screen);
            return screen;
        }

        // 구독 메시지를 만든다
        String subscribeTo(String room, int protocolVersion) {
            return "{\"type\":\"SUBSCRIBE\",\"roomId\":\"" + room + "\",\"protocolVersion\":" + protocolVersion
                    + ",\"lastSeenVersion\":0}";
        }

        // 새 소켓을 열어 구독하고 첫 스냅샷까지 받는다
        Screen subscribed() throws Exception {
            Screen screen = open();
            screen.say(subscribeTo(roomId, 1));
            screen.next("SNAPSHOT");
            return screen;
        }

        // 현재 상태 버전을 읽는다
        long version() throws Exception {
            return state().get("stateVersion").asLong();
        }

        // 이 참가자가 보는 스냅샷을 읽는다
        JsonNode state() throws Exception {
            return MAPPER.readTree(send("GET", "/api/rooms/" + roomId + "/state", cookie, null, null).body());
        }

        // 현재 버전으로 명령을 보낸다
        void command(String type, String payload) throws Exception {
            long n = ++sequence;
            HttpResponse<String> response = send("POST", "/api/rooms/" + roomId + "/commands", cookie, csrf,
                    "{\"protocolVersion\":1,\"requestId\":\"" + name + "-c" + n + "\",\"sequence\":" + n
                            + ",\"controlGeneration\":1,\"expectedStateVersion\":" + version()
                            + ",\"type\":\"" + type + "\",\"payload\":" + payload + "}");
            assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        }

        // 다른 화면으로 조작권을 가져온다
        void takeControl() throws Exception {
            long n = ++streamSequence;
            HttpResponse<String> response = send("POST", "/api/rooms/" + roomId + "/control", cookie, csrf,
                    "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"" + name + "-s" + n
                            + "\",\"sequence\":" + n + ",\"expectedControlGeneration\":1}");
            assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        }
    }

    // 방을 만든 방장을 돌려준다
    private Browser host() throws Exception {
        return new Browser("host").enter("/api/rooms", "\"name\":\"Host\"");
    }

    // 방에 참가한 사람을 돌려준다
    private Browser guest(Browser host, String name) throws Exception {
        return new Browser(name).enter("/api/room-joins", "\"code\":\"" + host.code + "\",\"name\":\"" + name + "\"");
    }

    // 스냅샷의 명단에서 참가자의 접속 여부를 읽는다
    private static boolean connected(JsonNode state, Browser who) {
        for (JsonNode p : state.get("participants")) {
            if (p.get("participantId").asString().equals(who.participantId)) {
                return p.get("connected").asBoolean();
            }
        }
        return fail("not on the roster");
    }

    // 참가자의 구독 연결 수를 읽는다
    private int connectionCount(Browser who) {
        return registry.withRoom(who.roomId, room -> room.presence().connectionCount(who.participantId));
    }

    // 참가자의 현재 접속 판정을 읽는다
    private boolean presence(Browser who) {
        return registry.withRoom(who.roomId, room -> room.presence().isConnected(who.participantId));
    }

    @Test
    void aBadOriginAMissingOriginAndNoSessionAreRefused() throws Exception {
        Browser b = host();

        assertThat(refusedStatus(b.cookie, "http://evil.example")).isEqualTo(403);
        assertThat(refusedStatus(b.cookie, null)).isEqualTo(403);
        assertThat(refusedStatus(null, ORIGIN)).isEqualTo(401);
        assertThat(refusedStatus("PCM_SESSION=stale", ORIGIN)).isEqualTo(401);
    }

    @Test
    void aSubscriberGetsTheCurrentSnapshotAndThenTheNextChangeWithItsEvents() throws Exception {
        Browser host = host();
        Browser bob = guest(host, "Bob");
        Screen hostScreen = host.subscribed();
        Screen bobScreen = bob.open();

        bobScreen.say(bob.subscribeTo(bob.roomId, 1));
        JsonNode first = bobScreen.next("SNAPSHOT");

        assertThat(first.get("previousVersion").isNull()).isTrue();
        assertThat(first.get("events")).isEmpty();
        assertThat(first.get("state").get("you").get("participantId").asString()).isEqualTo(bob.participantId);
        assertThat(connected(first.get("state"), bob)).isTrue();
        assertThat(hostScreen.snapshotAfter(0).get("state").get("roomPhase").asString()).isEqualTo("WAITING");

        long before = host.version();
        host.command("SET_DEALER", "{\"participantId\":\"" + host.participantId + "\"}");
        host.command("START", "{}");

        JsonNode started = bobScreen.next(m -> m.get("type").asString().equals("SNAPSHOT")
                && m.get("state").get("roomPhase").asString().equals("PLAYING"));
        assertThat(started.get("state").get("stateVersion").asLong()).isGreaterThan(before);
        assertThat(started.get("previousVersion").asLong()).isGreaterThanOrEqualTo(before);
        List<String> types = new ArrayList<>();
        started.get("events").forEach(e -> types.add(e.get("type").asString()));
        assertThat(types).contains("HAND_START");
    }

    @Test
    void closingTheSocketShowsTheParticipantDisconnectedOnOtherScreens() throws Exception {
        Browser host = host();
        Browser bob = guest(host, "Bob");
        Screen hostScreen = host.subscribed();
        Screen bobScreen = bob.subscribed();

        bobScreen.hangUp();

        hostScreen.next(m -> m.get("type").asString().equals("SNAPSHOT") && !connected(m.get("state"), bob)
                && m.get("state").get("stateVersion").asLong() > 0);
        assertThat(presence(bob)).isFalse();
    }

    @Test
    void aLateCloseOfTheOldSocketLeavesTheReconnectedParticipantConnected() throws Exception {
        Browser host = host();
        Browser bob = guest(host, "Bob");
        Screen hostScreen = host.subscribed();
        Screen old = bob.subscribed();
        Screen fresh = bob.subscribed();
        long version = bob.version();

        old.abort();
        await().atMost(WAIT).until(() -> hub.connections().size() == 2);

        assertThat(presence(bob)).isTrue();
        assertThat(bob.version()).isEqualTo(version);
        fresh.say("{\"type\":\"RESYNC\"}");
        assertThat(connected(fresh.next("SNAPSHOT").get("state"), bob)).isTrue();
        assertThat(hostScreen.closed).isNotDone();
    }

    @Test
    void theFifthConnectionOfAParticipantIsClosedAndTheOtherFourStay() throws Exception {
        Browser host = host();
        List<Screen> four = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            four.add(host.subscribed());
        }

        Screen fifth = host.open();
        fifth.say(host.subscribeTo(host.roomId, 1));

        assertThat(fifth.awaitClosed()).isEqualTo(1013);
        await().atMost(WAIT).until(() -> hub.connections().size() == 4);
        for (Screen screen : four) {
            screen.say("{\"type\":\"RESYNC\"}");
            screen.next("SNAPSHOT");
        }
        assertThat(connectionCount(host)).isEqualTo(4);
    }

    @Test
    void anInboundMessageOverTheLimitClosesTheConnectionAndChangesNothing() throws Exception {
        Browser host = host();
        Screen ok = host.subscribed();
        Screen tooBig = host.subscribed();
        Screen tooManyBytes = host.subscribed();
        long version = host.version();

        tooBig.say(pong(MAX_INBOUND_BYTES + 1));
        tooManyBytes.say("{\"type\":\"PONG\",\"nonce\":\"" + "가".repeat(MAX_INBOUND_BYTES / 3) + "\"}");
        ok.say(pong(MAX_INBOUND_BYTES));

        assertThat(tooBig.awaitClosed()).isEqualTo(1009);
        assertThat(tooManyBytes.awaitClosed()).isEqualTo(1009);
        await().atMost(WAIT).until(() -> hub.connections().size() == 1);
        ok.say("{\"type\":\"RESYNC\"}");
        ok.next("SNAPSHOT");
        assertThat(host.version()).isEqualTo(version);
    }

    // 정확히 주어진 바이트 수의 PONG을 만든다
    private static String pong(int bytes) {
        String shell = "{\"type\":\"PONG\",\"nonce\":\"\"}";
        return "{\"type\":\"PONG\",\"nonce\":\"" + "x".repeat(bytes - shell.length()) + "\"}";
    }

    @Test
    void malformedMessagesCloseTheConnectionWithoutTouchingTheRoom() throws Exception {
        Browser host = host();
        host.subscribed();
        long version = host.version();
        for (String bad : List.of("not json", "[]", "{}", "{\"type\":\"NOPE\"}", "{\"type\":\"SUBSCRIBE\"}",
                "{\"type\":\"SUBSCRIBE\",\"roomId\":1,\"protocolVersion\":1,\"lastSeenVersion\":0}",
                "{\"type\":\"SUBSCRIBE\",\"roomId\":\"r\",\"protocolVersion\":\"1\",\"lastSeenVersion\":0}",
                "{\"type\":\"SUBSCRIBE\",\"roomId\":\"r\",\"protocolVersion\":1,\"lastSeenVersion\":\"x\"}")) {
            Screen screen = host.open();
            screen.say(bad);
            assertThat(screen.awaitClosed()).as(bad).isEqualTo(1008);
        }
        assertThat(host.version()).isEqualTo(version);
    }

    @Test
    void subscribingToASecondRoomClosesTheConnection() throws Exception {
        Browser host = host();
        Browser other = new Browser("other").enter("/api/rooms", "\"name\":\"Other\"");
        Screen screen = host.subscribed();

        screen.say(other.subscribeTo(other.roomId, 1));

        assertThat(screen.awaitClosed()).isEqualTo(1008);
        await().atMost(WAIT).until(() -> !presence(host));
    }

    @Test
    void subscribingAgainToTheSameRoomResendsTheSnapshot() throws Exception {
        Browser host = host();
        Screen screen = host.subscribed();

        screen.say(host.subscribeTo(host.roomId, 1));

        assertThat(screen.next("SNAPSHOT").get("previousVersion").isNull()).isTrue();
        assertThat(connectionCount(host)).isEqualTo(1);
    }

    @Test
    void anotherProtocolVersionIsToldAndClosed() throws Exception {
        Browser host = host();
        Screen screen = host.open();

        screen.say(host.subscribeTo(host.roomId, 99));

        screen.next("PROTOCOL_INCOMPATIBLE");
        assertThat(screen.awaitClosed()).isEqualTo(1000);
        assertThat(presence(host)).isFalse();
    }

    @Test
    void aSessionWithoutASeatIsRevokedAndSeesNothing() throws Exception {
        Browser host = host();
        Browser stranger = new Browser("stranger");
        Screen screen = stranger.open();

        screen.say(stranger.subscribeTo(host.roomId, 1));

        assertThat(screen.next(m -> !m.get("type").asString().equals("PING")).get("type").asString())
                .isEqualTo("ACCESS_REVOKED");
        assertThat(screen.awaitClosed()).isEqualTo(1000);
    }

    @Test
    void anUnknownRoomLooksRevokedToASessionThatHasNoSeatInIt() throws Exception {
        Browser stranger = new Browser("stranger");
        Screen screen = stranger.open();

        screen.say(stranger.subscribeTo("no-such-room", 1));

        screen.next("ACCESS_REVOKED");
        assertThat(screen.awaitClosed()).isEqualTo(1000);
    }

    @Test
    void aKickedParticipantIsRevokedAndCannotSubscribeAgain() throws Exception {
        Browser host = host();
        Browser bob = guest(host, "Bob");
        host.subscribed();
        Screen bobScreen = bob.subscribed();

        host.command("KICK", "{\"participantId\":\"" + bob.participantId + "\"}");

        bobScreen.next("ACCESS_REVOKED");
        assertThat(bobScreen.awaitClosed()).isEqualTo(1000);
        Screen again = bob.open();
        again.say(bob.subscribeTo(bob.roomId, 1));
        again.next("ACCESS_REVOKED");
    }

    @Test
    void whenTheRoomIsDeletedTheRemainingPeopleGetRoomGone() throws Exception {
        Browser host = host();
        Browser bob = guest(host, "Bob");
        Screen hostScreen = host.subscribed();
        Screen bobScreen = bob.subscribed();

        registry.update(host.roomId, room -> {
            RoomTestAccess.close(room);
            return null;
        });

        hostScreen.next("ROOM_GONE");
        bobScreen.next("ROOM_GONE");
        assertThat(hostScreen.awaitClosed()).isEqualTo(1000);
        assertThat(bobScreen.awaitClosed()).isEqualTo(1000);
    }

    @Test
    void subscribingToADeletedRoomOfThisSessionIsRoomGone() throws Exception {
        Browser host = host();
        registry.remove(host.roomId);
        Screen screen = host.open();

        screen.say(host.subscribeTo(host.roomId, 1));

        screen.next("ROOM_GONE");
        assertThat(screen.awaitClosed()).isEqualTo(1000);
    }

    @Test
    void invalidatingTheSessionRevokesItsConnections() throws Exception {
        Browser host = host();
        Browser bob = guest(host, "Bob");
        Screen hostScreen = host.subscribed();
        Screen first = bob.subscribed();
        Screen second = bob.subscribed();

        assertThat(send("GET", "/test/expire-session", bob.cookie, null, null).statusCode()).isEqualTo(204);

        first.next("ACCESS_REVOKED");
        second.next("ACCESS_REVOKED");
        assertThat(first.awaitClosed()).isEqualTo(1000);
        assertThat(second.awaitClosed()).isEqualTo(1000);
        hostScreen.next(m -> m.get("type").asString().equals("SNAPSHOT") && !connected(m.get("state"), bob));
        assertThat(refusedStatus(bob.cookie, ORIGIN)).isEqualTo(401);
    }

    @Test
    void aResyncResendsTheCurrentStateWithoutMovingTheVersion() throws Exception {
        Browser host = host();
        Screen screen = host.subscribed();
        long version = host.version();

        screen.say("{\"type\":\"RESYNC\"}");

        JsonNode message = screen.next("SNAPSHOT");
        assertThat(message.get("previousVersion").isNull()).isTrue();
        assertThat(message.get("state").get("stateVersion").asLong()).isEqualTo(version);
        assertThat(host.version()).isEqualTo(version);
    }

    @Test
    void aTakeoverShowsEveryScreenOfThatParticipantTheNewGenerationWithoutAVersionBump() throws Exception {
        Browser host = host();
        Browser bob = guest(host, "Bob");
        Screen hostScreen = host.subscribed();
        Screen first = bob.subscribed();
        Screen second = bob.subscribed();
        long version = bob.version();

        bob.takeControl();

        for (Screen screen : List.of(first, second)) {
            JsonNode message = screen.next(m -> m.get("type").asString().equals("SNAPSHOT")
                    && m.get("state").get("you").get("controlGeneration").asLong() == 2);
            assertThat(message.get("state").get("stateVersion").asLong()).isEqualTo(version);
        }
        assertThat(bob.version()).isEqualTo(version);
        hostScreen.say("{\"type\":\"RESYNC\"}");
        assertThat(hostScreen.next(m -> m.get("type").asString().equals("SNAPSHOT")
                && m.get("state").get("stateVersion").asLong() == version)
                .get("state").get("you").get("controlGeneration").asLong()).isEqualTo(1);
    }

    @Test
    void aPongWithTheNonceOfThePingKeepsTheConnectionAliveWithoutMovingTheVersion() throws Exception {
        Browser host = host();
        Screen screen = host.subscribed();
        long version = host.version();
        Connection connection = hub.connections().getFirst();
        var before = connection.lastPong();

        connection.ping("nonce-1", version);
        JsonNode ping = screen.next("PING");
        assertThat(ping.get("stateVersion").asLong()).isEqualTo(version);
        screen.say("{\"type\":\"PONG\",\"nonce\":\"nonce-1\"}");

        await().atMost(WAIT).until(() -> connection.lastPong().isAfter(before));
        assertThat(host.version()).isEqualTo(version);
    }

    @Test
    void aSocketOverTheServerLimitIsClosedAfterTheHandshake() throws Exception {
        Browser host = host();
        List<Connection> filler = new ArrayList<>();
        for (int i = 0; i < 500; i++) {
            Connection c = Connection.open("filler-" + i, "s", new FakeSocket(), clock, hub::unregister);
            assertThat(hub.register(c)).isTrue();
            filler.add(c);
        }
        try {
            Screen screen = host.open();
            assertThat(screen.awaitClosed()).isEqualTo(1013);
        } finally {
            filler.forEach(Connection::close);
        }
    }

    @Test
    void aSocketClosedBeforeSubscribingLeavesNoTrace() throws Exception {
        Browser host = host();
        long version = host.version();

        Screen screen = host.open();
        await().atMost(WAIT).until(() -> hub.connections().size() == 1);
        screen.hangUp();
        await().atMost(WAIT).until(() -> hub.connections().isEmpty());

        assertThat(host.version()).isEqualTo(version);
        long stored = registry.withRoom(host.roomId, Room::version);
        assertThat(stored).isEqualTo(version);
    }

    @Test
    void aConnectionClosedWhileItsSubscribeWaitsForTheRoomStaysDetached() throws Exception {
        Browser host = host();
        Screen screen = host.open();
        await().atMost(WAIT).until(() -> hub.connections().size() == 1);
        Connection connection = hub.connections().getFirst();
        ReentrantLock roomLock = registry.withRoom(host.roomId, Room::lock);

        roomLock.lock();
        try {
            screen.say(host.subscribeTo(host.roomId, 1));
            await().atMost(WAIT).until(() -> roomLock.getQueueLength() == 1);
            connection.close();
            await().atMost(WAIT).until(() -> roomLock.getQueueLength() == 2);
        } finally {
            roomLock.unlock();
        }

        await().atMost(WAIT).until(() -> !roomLock.isLocked() && !roomLock.hasQueuedThreads());
        assertThat(connectionCount(host)).isZero();
        assertThat(presence(host)).isFalse();
    }

    @Test
    void theHeartbeatIsScheduled() {
        assertThat(scheduled.getScheduledTasks()).extracting(Object::toString)
                .anyMatch(task -> task.contains("HeartbeatTask.tick"));
    }
}
