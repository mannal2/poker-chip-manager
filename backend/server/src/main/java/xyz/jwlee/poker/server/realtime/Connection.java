package xyz.jwlee.poker.server.realtime;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

// 소켓 하나의 전송 대기열과 생존 기록을 맡고 가상 스레드 하나로 전송한다
/**
 * Every offer returns at once, whatever the socket is doing: besides the send in progress only one PING, the
 * latest snapshot and one final message wait here, so a stuck client costs no memory and holds up nobody (X06).
 * Publications run unlocked and can swap, so a snapshot lower than one already offered is dropped; an equal one
 * still goes out, because a resync or a takeover repeats the version with a new view (R9). A final message
 * outranks everything and nothing follows it. {@link #close} never touches the socket on the calling thread:
 * closing a socket whose send is stuck can itself wait for that send.
 */
public final class Connection {

    static final int CLOSE_NORMAL = 1000;
    static final int CLOSE_POLICY = 1008;
    static final int CLOSE_TOO_BIG = 1009;
    static final int CLOSE_TRY_LATER = 1013;

    private static final int MAX_MESSAGE_BYTES = 256 * 1024;
    private static final Logger LOG = LoggerFactory.getLogger(Connection.class);

    // 연결이 쓰는 소켓의 전송과 닫기
    public interface Socket {
        // 텍스트 메시지 하나를 보내고 끝날 때까지 기다린다
        void send(String text) throws IOException;

        // 주어진 코드로 소켓을 닫는다
        void close(int code) throws IOException;
    }

    // 다음에 보낼 메시지와 그 뒤 연결을 끝낼지 여부
    private record Outgoing(ObjectNode message, boolean last) { }

    private final String connectionId;
    private final String sessionId;
    private final Socket socket;
    private final Clock clock;
    private final Consumer<Connection> onClosed;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition wake = lock.newCondition();
    private final AtomicBoolean closing = new AtomicBoolean();

    // 아래 일곱 필드는 lock으로 보호한다
    private ObjectNode pendingFinal;
    private boolean finalOffered;
    private ObjectNode pendingPing;
    private ObjectNode pendingSnapshot;
    private long highestStateVersion = Long.MIN_VALUE;
    private long highestDraftVersion = Long.MIN_VALUE;
    private String expectedNonce;

    private volatile Instant sendingSince;
    private volatile Instant lastPong;
    private volatile Instant lastPing;
    private volatile String roomId;

    private Connection(String connectionId, String sessionId, Socket socket, Clock clock, Consumer<Connection> onClosed) {
        this.connectionId = connectionId;
        this.sessionId = sessionId;
        this.socket = socket;
        this.clock = clock;
        this.onClosed = onClosed;
        this.lastPong = clock.instant();
        this.lastPing = lastPong;
    }

    // 연결을 만들고 전송 스레드를 시작한다
    /** {@code onClosed} runs once, on its own virtual thread, after {@link #isClosed} turned true. */
    public static Connection open(
            String connectionId, String sessionId, Socket socket, Clock clock, Consumer<Connection> onClosed) {
        Connection connection = new Connection(connectionId, sessionId, socket, clock, onClosed);
        Thread.ofVirtual().name("ws-send-" + connectionId).start(connection::sendLoop);
        return connection;
    }

    public String connectionId() { return connectionId; }
    public String sessionId() { return sessionId; }

    // 구독한 방을 돌려주고 구독 전이면 null을 돌려준다
    String roomId() { return roomId; }

    // 구독한 방을 기록한다. 방 잠금으로 연결을 붙이기 전에 불러서 닫힘 처리가 방을 놓치지 않게 한다
    void subscribeTo(String roomId) { this.roomId = roomId; }

    // 닫히기 시작했는지 확인한다
    boolean isClosed() { return closing.get(); }

    Instant lastPong() { return lastPong; }
    Instant lastPing() { return lastPing; }

    // 진행 중인 전송의 시작 시각을 돌려준다
    public Optional<Instant> sendingSince() {
        return Optional.ofNullable(sendingSince);
    }

    // 스냅샷을 최신 칸에 넣는다. 이미 받은 것보다 낮으면 버린다
    public void offerSnapshot(ObjectNode message) {
        JsonNode state = message.path("state");
        long stateVersion = state.path("stateVersion").asLong(0);
        long draftVersion = state.path("draftVersion").asLong(0);
        lock.lock();
        try {
            boolean lower = stateVersion < highestStateVersion
                    || stateVersion == highestStateVersion && draftVersion < highestDraftVersion;
            if (closing.get() || finalOffered || lower) {
                return;
            }
            highestStateVersion = stateVersion;
            highestDraftVersion = draftVersion;
            pendingSnapshot = message;
            wake.signalAll();
        } finally {
            lock.unlock();
        }
    }

    // 마지막 메시지를 넣는다. 먼저 온 것이 유지되고 기다리던 다른 메시지는 버린다
    public void offerFinal(ObjectNode message) {
        lock.lock();
        try {
            if (closing.get() || finalOffered) {
                return;
            }
            finalOffered = true;
            pendingFinal = message;
            pendingSnapshot = null;
            pendingPing = null;
            wake.signalAll();
        } finally {
            lock.unlock();
        }
    }

    // PING을 보낼 칸에 넣고 이 nonce의 응답만 기다린다
    /** {@code stateVersion} is null while there is no room to report. */
    void ping(String nonce, Long stateVersion) {
        ObjectNode message = JsonNodeFactory.instance.objectNode().put("type", "PING").put("nonce", nonce);
        message.put("stateVersion", stateVersion);
        lock.lock();
        try {
            lastPing = clock.instant();
            if (closing.get() || finalOffered) {
                return;
            }
            expectedNonce = nonce;
            pendingPing = message;
            wake.signalAll();
        } finally {
            lock.unlock();
        }
    }

    // 기다리던 nonce의 응답이면 마지막 응답 시각을 갱신한다
    void pong(String nonce) {
        lock.lock();
        try {
            if (nonce != null && nonce.equals(expectedNonce)) {
                expectedNonce = null;
                lastPong = clock.instant();
            }
        } finally {
            lock.unlock();
        }
    }

    // 정상 코드로 연결을 닫는다
    public void close() {
        close(CLOSE_NORMAL);
    }

    // 연결을 닫는다. 소켓 닫기와 콜백은 별도 가상 스레드에서 한 번만 실행한다
    void close(int code) {
        if (!closing.compareAndSet(false, true)) {
            return;
        }
        lock.lock();
        try {
            pendingFinal = null;
            pendingSnapshot = null;
            pendingPing = null;
            wake.signalAll();
        } finally {
            lock.unlock();
        }
        Thread.ofVirtual().name("ws-close-" + connectionId).start(() -> finish(code));
    }

    // 닫힘을 알린 뒤 소켓을 닫는다. 소켓 닫기가 오래 걸려도 접속 판정은 늦지 않는다
    private void finish(int code) {
        try {
            onClosed.accept(this);
        } catch (RuntimeException e) {
            LOG.error("Closing connection {} failed", connectionId, e);
        } finally {
            try {
                socket.close(code);
            } catch (IOException | RuntimeException e) {
                LOG.debug("Socket of connection {} was already closed", connectionId, e);
            }
        }
    }

    // 닫힐 때까지 메시지를 하나씩 꺼내 보낸다
    private void sendLoop() {
        try {
            Outgoing next = take();
            while (next != null) {
                String text = next.message().toString();
                if (text.getBytes(StandardCharsets.UTF_8).length > MAX_MESSAGE_BYTES) {
                    close(CLOSE_TOO_BIG);
                    return;
                }
                send(text);
                if (next.last()) {
                    close(CLOSE_NORMAL);
                    return;
                }
                next = take();
            }
        } catch (IOException | RuntimeException e) {
            LOG.debug("Sending on connection {} failed", connectionId, e);
            close(CLOSE_NORMAL);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            close(CLOSE_NORMAL);
        }
    }

    // 전송 시작 시각을 기록하며 메시지 하나를 보낸다
    private void send(String text) throws IOException {
        sendingSince = clock.instant();
        try {
            socket.send(text);
        } finally {
            sendingSince = null;
        }
    }

    // 보낼 메시지가 생길 때까지 기다리고 닫히면 null을 돌려준다
    private Outgoing take() throws InterruptedException {
        lock.lock();
        try {
            while (!closing.get()) {
                Outgoing next = poll();
                if (next != null) {
                    return next;
                }
                wake.await();
            }
            return null;
        } finally {
            lock.unlock();
        }
    }

    // 마지막 메시지, PING, 스냅샷 순서로 하나를 꺼낸다. 호출자가 잠금을 잡고 있다
    private Outgoing poll() {
        Outgoing next = null;
        if (pendingFinal != null) {
            next = new Outgoing(pendingFinal, true);
            pendingFinal = null;
        } else if (pendingPing != null) {
            next = new Outgoing(pendingPing, false);
            pendingPing = null;
        } else if (pendingSnapshot != null) {
            next = new Outgoing(pendingSnapshot, false);
            pendingSnapshot = null;
        }
        return next;
    }
}
