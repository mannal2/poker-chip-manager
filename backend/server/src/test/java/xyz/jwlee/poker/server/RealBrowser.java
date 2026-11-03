package xyz.jwlee.poker.server;

import static org.assertj.core.api.Assertions.assertThat;

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
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Predicate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

// 실제 포트에 쿠키·CSRF·Origin·WebSocket으로 접속하는 브라우저 하나를 흉내 낸다
final class RealBrowser {

    static final String ORIGIN = "http://localhost:5173";
    static final ObjectMapper MAPPER = new ObjectMapper();
    static final Duration WAIT = Duration.ofSeconds(10);

    private final HttpClient http;
    private final int port;
    final String name;
    final String cookie;
    final String csrf;
    final String streamId;
    String roomId;
    String code;
    String participantId;
    Screen screen;
    private long screenSequence;
    private long commandSequence;

    // 세션과 화면 스트림을 연다
    RealBrowser(HttpClient http, int port, String name) throws Exception {
        this.http = http;
        this.port = port;
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

    // 지정한 헤더로 실제 HTTP 요청을 보낸다
    HttpResponse<String> send(String method, String path, String withCookie, String withCsrf, String body,
            String origin) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .method(method, body == null ? BodyPublishers.noBody() : BodyPublishers.ofString(body))
                .header("Origin", origin).header("Content-Type", "application/json");
        if (withCookie != null) {
            b.header("Cookie", withCookie);
        }
        if (withCsrf != null) {
            b.header("X-CSRF-TOKEN", withCsrf);
        }
        return http.send(b.build(), BodyHandlers.ofString());
    }

    // 생성·참가 요청을 보내고 소켓을 열어 구독한다
    JsonNode enter(String path, String fields, int status) throws Exception {
        long n = ++screenSequence;
        String body = "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"" + name + "-s" + n
                + "\",\"sequence\":" + n + "," + fields + "}";
        JsonNode answer = expect(send("POST", path, cookie, csrf, body, ORIGIN), status);
        roomId = answer.get("roomId").asString();
        code = answer.get("code").asString();
        participantId = answer.get("participantId").asString();
        subscribe();
        return answer;
    }

    // 새 소켓을 열어 구독하고 첫 스냅샷까지 받는다
    Screen subscribe() throws Exception {
        screen = new Screen();
        http.newWebSocketBuilder().header("Cookie", cookie).header("Origin", ORIGIN)
                .buildAsync(URI.create("ws://localhost:" + port + "/ws"), screen)
                .get(WAIT.toSeconds(), TimeUnit.SECONDS);
        screen.say("{\"type\":\"SUBSCRIBE\",\"roomId\":\"" + roomId + "\",\"protocolVersion\":1,"
                + "\"lastSeenVersion\":null}");
        screen.awaitState(state -> true);
        return screen;
    }

    // 최신 상태를 읽어 그 범위로 명령을 보낸다
    JsonNode command(String type, String payload, int status) throws Exception {
        JsonNode now = state();
        JsonNode game = now.get("game");
        String tournamentId = now.get("tournamentId").isNull() ? null : now.get("tournamentId").asString();
        String handId = game.isNull() || game.get("hand").isNull() ? null : game.get("hand").get("id").asString();
        return commandAt(type, payload, tournamentId, handId, status);
    }

    // 지정한 토너먼트·핸드 범위로 명령을 보낸다
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

    // 이 참가자가 보는 현재 스냅샷을 읽는다
    JsonNode state() throws Exception {
        return get("/api/rooms/" + roomId + "/state", 200);
    }

    // 세션 쿠키로 조회한다
    JsonNode get(String path, int status) throws Exception {
        return expect(send("GET", path, cookie, null, null, ORIGIN), status);
    }

    // 화면이 마지막으로 받은 SNAPSHOT이 GET state와 같을 때까지 기다려 돌려준다
    JsonNode screenInSync() throws Exception {
        JsonNode state = state();
        long version = state.get("stateVersion").asLong();
        long draft = state.get("draftVersion").asLong();
        JsonNode shown = screen.awaitState(s -> s.get("stateVersion").asLong() == version
                && s.get("draftVersion").asLong() == draft);
        assertThat(shown).isEqualTo(state);
        return shown;
    }

    // 스냅샷에서 이 참가자가 접속 중인지 확인한다
    boolean connectedIn(JsonNode state) {
        return seatIn(state).map(seat -> seat.get("connected").asBoolean()).orElse(false);
    }

    // 스냅샷에서 이 참가자가 명단에 있고 끊겨 있는지 확인한다
    boolean absentIn(JsonNode state) {
        return seatIn(state).map(seat -> !seat.get("connected").asBoolean()).orElse(false);
    }

    // 스냅샷의 명단에서 이 참가자를 찾는다
    private Optional<JsonNode> seatIn(JsonNode state) {
        for (JsonNode p : state.get("participants")) {
            if (p.get("participantId").asString().equals(participantId)) {
                return Optional.of(p);
            }
        }
        return Optional.empty();
    }

    // 이 토너먼트의 기록을 조건에 맞는 것만 순서대로 읽는다
    List<JsonNode> history(String tournamentId, Predicate<JsonNode> wanted) throws Exception {
        List<JsonNode> out = new ArrayList<>();
        get("/api/rooms/" + roomId + "/history?tournamentId=" + tournamentId, 200).get("events").forEach(e -> {
            if (wanted.test(e)) {
                out.add(e);
            }
        });
        return out;
    }

    // 응답 코드를 확인하고 본문을 읽는다
    private static JsonNode expect(HttpResponse<String> response, int status) {
        assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
        return MAPPER.readTree(response.body());
    }

    // 소켓 하나를 흉내 내며 PING에 답하고 받은 상태를 기억한다
    static final class Screen implements WebSocket.Listener {
        final AtomicInteger pongs = new AtomicInteger();
        final CompletableFuture<Integer> closed = new CompletableFuture<>();
        private final BlockingQueue<JsonNode> inbox = new LinkedBlockingQueue<>();
        private final StringBuilder partial = new StringBuilder();
        private CompletableFuture<WebSocket> outgoing;
        private WebSocket socket;
        private volatile boolean silent;
        private JsonNode lastState;

        // 열린 소켓을 기억하고 첫 메시지를 요청한다
        @Override
        public void onOpen(WebSocket webSocket) {
            socket = webSocket;
            outgoing = CompletableFuture.completedFuture(webSocket);
            webSocket.request(1);
        }

        // 조각을 이어 메시지 하나로 만들고 PING이면 답한다
        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            partial.append(data);
            if (last) {
                JsonNode message = MAPPER.readTree(partial.toString());
                partial.setLength(0);
                if (message.get("type").asString().equals("PING")) {
                    answer(message);
                } else {
                    inbox.add(message);
                }
            }
            webSocket.request(1);
            return null;
        }

        // 닫기 코드를 기록한다
        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            closed.complete(statusCode);
            return null;
        }

        // 전송 오류를 닫힘으로 기록한다
        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            closed.complete(-1);
        }

        // 응답하지 않기로 했으면 건너뛰고 아니면 같은 nonce로 답한다
        private void answer(JsonNode ping) {
            if (!silent) {
                say("{\"type\":\"PONG\",\"nonce\":\"" + ping.get("nonce").asString() + "\"}")
                        .thenRun(pongs::incrementAndGet);
            }
        }

        // 앞선 전송이 끝난 뒤 텍스트 프레임 하나를 보낸다
        synchronized CompletableFuture<WebSocket> say(String text) {
            outgoing = outgoing.thenCompose(open -> open.sendText(text, true));
            return outgoing;
        }

        // 이제부터 PING에 답하지 않아 응답 없는 기기가 된다
        void goSilent() {
            silent = true;
        }

        // 조건에 맞는 상태를 받을 때까지 기다린다. 마지막으로 받은 상태도 후보다
        JsonNode awaitState(Predicate<JsonNode> wanted) throws Exception {
            long deadline = System.nanoTime() + WAIT.toNanos();
            while (lastState == null || !wanted.test(lastState)) {
                JsonNode message = inbox.poll(deadline - System.nanoTime(), TimeUnit.NANOSECONDS);
                if (message == null) {
                    throw new AssertionError("no matching snapshot arrived, the last one was " + lastState);
                }
                if (message.get("type").asString().equals("SNAPSHOT")) {
                    lastState = message.get("state");
                }
            }
            return lastState;
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
}
