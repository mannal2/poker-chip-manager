package xyz.jwlee.poker.server.realtime;

import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import org.springframework.context.ApplicationContext;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.auth.WebSocketHandshakeGuard;

// MockMvc 세션으로 실제 핸드셰이크 검사와 소켓 처리기를 지나 보낸 글자를 기록하는 계약 예시용 화면
/**
 * {@code ApiContractTest} uses MockMvc, whose sessions a real socket cannot present. Only the transport is replaced
 * here: the guard, the handler, the connection and the hub are the real beans, so a recorded message is what they
 * put on the wire.
 */
public final class ContractScreen {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final long WAIT_SECONDS = 5;
    private static final String ORIGIN = "http://localhost:5173";
    private static final String CONNECTION = "pcm.connection";

    private final RoomSocketHandler handler;
    private final Map<String, Object> attributes = new HashMap<>();
    private final BlockingQueue<JsonNode> inbox = new LinkedBlockingQueue<>();
    private final CompletableFuture<Integer> closed = new CompletableFuture<>();
    private final WebSocketSession socket;

    // 핸드셰이크 검사를 지나 소켓을 연다
    public ContractScreen(ApplicationContext context, MockHttpSession session) throws Exception {
        handler = context.getBean(RoomSocketHandler.class);
        MockHttpServletRequest handshake = new MockHttpServletRequest("GET", "/ws");
        handshake.addHeader("Origin", ORIGIN);
        handshake.setSession(session);
        context.getBean(WebSocketHandshakeGuard.class)
                .beforeHandshake(new ServletServerHttpRequest(handshake), null, handler, attributes);
        socket = socket();
        handler.afterConnectionEstablished(socket);
    }

    // 전송과 닫기만 기록하는 소켓을 만든다. 나머지 메서드는 처리기가 쓰지 않는다
    private WebSocketSession socket() {
        return (WebSocketSession) Proxy.newProxyInstance(WebSocketSession.class.getClassLoader(),
                new Class<?>[] {WebSocketSession.class}, (proxy, method, arguments) -> switch (method.getName()) {
                    case "getAttributes" -> attributes;
                    case "sendMessage" -> {
                        inbox.add(MAPPER.readTree(((WebSocketMessage<?>) arguments[0]).getPayload().toString()));
                        yield null;
                    }
                    case "close" -> {
                        closed.complete(((CloseStatus) arguments[0]).getCode());
                        yield null;
                    }
                    case "setTextMessageSizeLimit", "setBinaryMessageSizeLimit" -> null;
                    default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    // 클라이언트 메시지 하나를 처리기에 넣는다
    public void say(String text) throws Exception {
        handler.handleMessage(socket, new TextMessage(text));
    }

    // 서버의 생존 확인 하나를 내보낸다. 고정 시계에서는 주기가 오지 않으므로 직접 부른다
    public void ping(String nonce, long stateVersion) {
        ((Connection) attributes.get(CONNECTION)).ping(nonce, stateVersion);
    }

    // 조건에 맞는 메시지가 올 때까지 기다린다
    public JsonNode next(Predicate<JsonNode> wanted) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS);
        while (true) {
            JsonNode message = inbox.poll(deadline - System.nanoTime(), TimeUnit.NANOSECONDS);
            if (message == null) {
                throw new AssertionError("no matching message arrived");
            }
            if (wanted.test(message)) {
                return message;
            }
        }
    }

    // 지정한 종류의 메시지를 기다린다
    public JsonNode next(String type) throws Exception {
        return next(message -> message.get("type").asString().equals(type));
    }

    // 소켓이 닫힐 때까지 기다리고 닫기 코드를 돌려준다
    public int awaitClosed() throws Exception {
        return closed.get(WAIT_SECONDS, TimeUnit.SECONDS);
    }
}
