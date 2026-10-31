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
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.RoomTestAccess;

// 실제 포트와 쿠키로 복구 승인 뒤 옛 소켓과 옛 쿠키의 접근 폐기를 검사한다
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RecoverySocketHttpTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Duration WAIT = Duration.ofSeconds(5);

    @LocalServerPort
    int port;

    @Autowired
    RoomRegistry registry;

    @Autowired
    ConnectionHub hub;

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

        // 조건에 맞는 메시지가 올 때까지 기다린다
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

        // 화면 스트림 요청 본문을 만든다
        private String envelope(String fields) {
            long n = ++streamSequence;
            return "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"" + name + "-s" + n
                    + "\",\"sequence\":" + n + "," + fields + "}";
        }

        // 방을 만들거나 코드로 참가한다
        Browser enter(String path, String fields) throws Exception {
            JsonNode answer = MAPPER.readTree(send("POST", path, cookie, csrf, envelope(fields)).body());
            roomId = answer.get("roomId").asString();
            code = answer.get("code").asString();
            participantId = answer.get("participantId").asString();
            return this;
        }

        // 복구를 신청하고 신청 ID를 돌려준다
        String ask(String roomCode, String seatName) throws Exception {
            HttpResponse<String> response = send("POST", "/api/recovery-requests", cookie, csrf,
                    envelope("\"code\":\"" + roomCode + "\",\"name\":\"" + seatName + "\""));
            assertThat(response.statusCode()).as(response.body()).isEqualTo(201);
            return MAPPER.readTree(response.body()).get("recoveryRequestId").asString();
        }

        // 승인된 신청을 조회해 자리를 넘겨받는다
        void claim(String recoveryRequestId) throws Exception {
            JsonNode answer = MAPPER.readTree(
                    send("GET", "/api/recovery-requests/" + recoveryRequestId, cookie, null, null).body());
            assertThat(answer.get("status").asString()).isEqualTo("APPROVED");
            roomId = answer.get("roomId").asString();
            code = answer.get("code").asString();
            participantId = answer.get("participantId").asString();
        }

        // 새 소켓을 연다
        Screen open() throws Exception {
            Screen screen = new Screen();
            http.newWebSocketBuilder().header("Cookie", cookie).header("Origin", ORIGIN)
                    .buildAsync(URI.create("ws://localhost:" + port + "/ws"), screen)
                    .get(WAIT.toSeconds(), TimeUnit.SECONDS);
            screens.add(screen);
            return screen;
        }

        // 구독 메시지를 만든다
        String subscribe() {
            return "{\"type\":\"SUBSCRIBE\",\"roomId\":\"" + roomId + "\",\"protocolVersion\":1,"
                    + "\"lastSeenVersion\":0}";
        }

        // 새 소켓을 열어 구독하고 첫 스냅샷까지 받는다
        Screen subscribed() throws Exception {
            Screen screen = open();
            screen.say(subscribe());
            screen.next("SNAPSHOT");
            return screen;
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
                            + ",\"controlGeneration\":1,\"expectedStateVersion\":"
                            + state().get("stateVersion").asLong() + ",\"type\":\"" + type + "\",\"payload\":"
                            + payload + "}");
            assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        }

        // 신청을 승인한다
        void approve(String recoveryRequestId) throws Exception {
            command("RECOVERY_APPROVE", "{\"recoveryRequestId\":\"" + recoveryRequestId + "\"}");
        }
    }

    // 방을 만든 방장을 돌려준다
    private Browser host() throws Exception {
        return new Browser("host").enter("/api/rooms", "\"name\":\"Host\"");
    }

    // 방에 Bob을 참가시킨다
    private Browser bob(Browser host) throws Exception {
        return new Browser("bob").enter("/api/room-joins", "\"code\":\"" + host.code + "\",\"name\":\"Bob\"");
    }

    // 메시지가 조건을 만족하는 스냅샷인지 확인한다
    private static Predicate<JsonNode> snapshot(Predicate<JsonNode> state) {
        return m -> m.get("type").asString().equals("SNAPSHOT") && state.test(m.get("state"));
    }

    // PING과 SNAPSHOT을 건너뛴 다음 메시지의 종류를 읽는다
    private static String nextControl(Screen screen) throws Exception {
        return screen.next(m -> !List.of("PING", "SNAPSHOT").contains(m.get("type").asString()))
                .get("type").asString();
    }

    // 연결을 둔 채 자격만 바꿔 승인 직후의 틈을 만든다
    private void staleCredential(Browser seat) {
        registry.update(seat.roomId, room -> {
            RoomTestAccess.replaceCredential(room, seat.participantId, "moved-on");
            return null;
        });
    }

    @Test
    void theHostsScreenShowsARequestAndOnlyTheHosts() throws Exception {
        Browser host = host();
        Browser bob = bob(host);
        Screen hostScreen = host.subscribed();
        Screen bobScreen = bob.subscribed();
        long version = host.state().get("stateVersion").asLong();

        new Browser("device").ask(host.code, "Bob");

        hostScreen.next(snapshot(state -> state.get("recoveryRequests").size() == 1));
        JsonNode bobs = bobScreen.next(snapshot(state -> state.get("stateVersion").asLong() > version));
        assertThat(bobs.get("state").get("recoveryRequests")).isEmpty();
    }

    @Test
    void approvalClosesTheOldSocketsWithAccessRevokedAndTheOldCookieCannotSubscribeAgain() throws Exception {
        Browser host = host();
        Browser bob = bob(host);
        Screen hostScreen = host.subscribed();
        Screen first = bob.subscribed();
        Screen second = bob.subscribed();
        Browser device = new Browser("device");

        host.approve(device.ask(host.code, "Bob"));

        assertThat(nextControl(first)).isEqualTo("ACCESS_REVOKED");
        assertThat(nextControl(second)).isEqualTo("ACCESS_REVOKED");
        assertThat(first.awaitClosed()).isEqualTo(1000);
        assertThat(second.awaitClosed()).isEqualTo(1000);
        assertThat(hostScreen.closed).isNotDone();

        Screen again = bob.open();
        again.say(bob.subscribe());
        assertThat(nextControl(again)).isEqualTo("ACCESS_REVOKED");
        assertThat(again.awaitClosed()).isEqualTo(1000);
    }

    @Test
    void theNewDeviceSubscribesAsTheSeatAndTheOldSocketsCloseLeavesItConnected() throws Exception {
        Browser host = host();
        Browser bob = bob(host);
        host.subscribed();
        Screen old = bob.subscribed();
        Browser device = new Browser("device");
        String id = device.ask(host.code, "Bob");

        host.approve(id);
        device.claim(id);
        old.awaitClosed();
        Screen fresh = device.open();
        fresh.say(device.subscribe());

        JsonNode first = fresh.next("SNAPSHOT").get("state");
        assertThat(first.get("you").get("participantId").asString()).isEqualTo(bob.participantId);
        assertThat(first.get("you").get("controlGeneration").asLong()).isEqualTo(2);
        await().atMost(WAIT).until(() -> hub.connections().size() == 2);
        assertThat(registry.<Boolean>withRoom(bob.roomId,
                room -> room.presence().isConnected(bob.participantId))).isTrue();
    }

    @Test
    void aSocketLeftAttachedWithAStaleCredentialIsRevokedOnResync() throws Exception {
        Browser host = host();
        Browser bob = bob(host);
        Screen screen = bob.subscribed();
        staleCredential(bob);

        screen.say("{\"type\":\"RESYNC\"}");

        assertThat(nextControl(screen)).isEqualTo("ACCESS_REVOKED");
        assertThat(screen.awaitClosed()).isEqualTo(1000);
    }

    @Test
    void aSocketLeftAttachedWithAStaleCredentialIsRevokedOnASecondSubscribe() throws Exception {
        Browser host = host();
        Browser bob = bob(host);
        Screen screen = bob.subscribed();
        staleCredential(bob);

        screen.say(bob.subscribe());

        assertThat(nextControl(screen)).isEqualTo("ACCESS_REVOKED");
        assertThat(screen.awaitClosed()).isEqualTo(1000);
    }

    @Test
    void aRequesterHasNoSubscriptionRightWhilePending() throws Exception {
        Browser host = host();
        bob(host);
        Browser device = new Browser("device");
        device.ask(host.code, "Bob");
        device.roomId = host.roomId;
        Screen screen = device.open();

        screen.say(device.subscribe());

        assertThat(nextControl(screen)).isEqualTo("ACCESS_REVOKED");
    }
}
