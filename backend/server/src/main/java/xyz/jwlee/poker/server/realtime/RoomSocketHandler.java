package xyz.jwlee.poker.server.realtime;

import java.io.IOException;
import java.time.Clock;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import xyz.jwlee.poker.server.auth.SessionIdentity;
import xyz.jwlee.poker.server.auth.WebSocketHandshakeGuard;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.ErrorCode;
import xyz.jwlee.poker.server.room.Participant;
import xyz.jwlee.poker.server.room.PresenceGrace;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomEnv;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.RoomLifecycle;
import xyz.jwlee.poker.server.room.SeatBinding;
import xyz.jwlee.poker.server.room.StartGate;
import xyz.jwlee.poker.server.support.IdGenerator;
import xyz.jwlee.poker.server.support.Protocol;

// 소켓의 열림과 닫힘, 클라이언트 메시지(SUBSCRIBE, PONG, RESYNC)를 처리한다
/**
 * A bad message closes the socket and changes nothing. Reading the session here never touches its idle timer, so
 * socket traffic does not extend a session. The seat check, the connection limit, {@code connected} and the
 * first snapshot share one {@code RoomRegistry.update}, which leaves no gap between subscribing and the snapshot
 * (M05). Every SUBSCRIBE and RESYNC checks the session's seat credential under the room lock, so a socket of a
 * device that lost its seat gets nothing more.
 *
 * <p>Close race: a subscribe records the room first and then, under the room lock, attaches only if the connection
 * is not closing; a close sets closing first and then detaches under the room lock. Whichever comes second sees the
 * other, so a connection that closed mid-subscribe never stays attached.
 */
@Component
class RoomSocketHandler extends TextWebSocketHandler {

    private static final int MAX_INBOUND_BYTES = 4096;
    private static final int MAX_CONNECTIONS_PER_PARTICIPANT = 4;
    private static final String CONNECTION = "pcm.connection";
    private static final Logger LOG = LoggerFactory.getLogger(RoomSocketHandler.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    // 방 잠금 안에서 내린 구독 판정
    private enum Subscription { ACCEPTED, NO_SEAT, FULL, CLOSING }

    // Spring 소켓을 연결이 쓰는 소켓으로 맞춘다
    private record SpringSocket(WebSocketSession session) implements Connection.Socket {
        // 소켓에 텍스트 메시지를 보낸다
        @Override
        public void send(String text) throws IOException {
            session.sendMessage(new TextMessage(text));
        }

        // 지정한 코드로 소켓을 닫는다
        @Override
        public void close(int code) throws IOException {
            session.close(new CloseStatus(code));
        }
    }

    private final ConnectionHub hub;
    private final RoomRegistry registry;
    private final Clock clock;
    private final IdGenerator ids;
    private final RoomEnv env;

    // 소켓 핸들러에 필요한 협력 객체를 주입받는다
    RoomSocketHandler(ConnectionHub hub, RoomRegistry registry, Clock clock, IdGenerator ids, StartGate gate,
            PresenceGrace grace) {
        this.hub = hub;
        this.registry = registry;
        this.clock = clock;
        this.ids = ids;
        this.env = new RoomEnv(clock, ids, gate, grace);
    }

    // 새 connectionId로 연결을 만들고 서버 전체나 세션별 한도를 넘으면 닫는다
    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        session.setTextMessageSizeLimit(MAX_INBOUND_BYTES);
        session.setBinaryMessageSizeLimit(MAX_INBOUND_BYTES);
        String sessionId = identity(session).id();
        Connection connection = Connection.open(ids.next(), sessionId, new SpringSocket(session), clock, this::closed);
        session.getAttributes().put(CONNECTION, connection);
        if (!hub.register(connection)) {
            connection.close(Connection.CLOSE_TRY_LATER);
        }
    }

    // 소켓이 닫히면 연결도 닫는다
    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        connection(session).close();
    }

    // 전송 계층 오류도 닫힘으로 처리한다
    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        connection(session).close();
    }

    // 크기와 형식을 확인한 뒤 메시지 종류별로 처리한다
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Connection connection = connection(session);
        if (message.getPayloadLength() > MAX_INBOUND_BYTES) {
            connection.close(Connection.CLOSE_TOO_BIG);
            return;
        }
        Optional<JsonNode> parsed = parse(message.getPayload());
        String type = parsed.map(node -> textOrNull(node.get("type"))).orElse("");
        switch (type) {
            case "SUBSCRIBE" -> subscribe(connection, parsed.get(), identity(session));
            case "PONG" -> pong(connection, parsed.get());
            case "RESYNC" -> resync(connection, identity(session));
            default -> connection.close(Connection.CLOSE_POLICY);
        }
    }

    // JSON 객체를 읽고 잘못되었으면 빈 값을 돌려준다
    private static Optional<JsonNode> parse(String payload) {
        try {
            return Optional.of(JSON.readTree(payload)).filter(JsonNode::isObject);
        } catch (JacksonException e) {
            return Optional.empty();
        }
    }

    // 문자열 값을 읽고 문자열이 아니면 null을 돌려준다
    private static String textOrNull(JsonNode node) {
        return node != null && node.isString() ? node.asString() : null;
    }

    // 구독 메시지를 검사하고 방에 연결을 붙인다
    private void subscribe(Connection connection, JsonNode message, SessionIdentity identity) {
        String roomId = textOrNull(message.get("roomId"));
        JsonNode protocol = message.get("protocolVersion");
        JsonNode lastSeen = message.get("lastSeenVersion");
        boolean wellFormed = roomId != null && protocol != null && protocol.isIntegralNumber()
                && lastSeen != null && (lastSeen.isNull() || lastSeen.isIntegralNumber());
        if (!wellFormed || connection.roomId() != null && !connection.roomId().equals(roomId)) {
            connection.close(Connection.CLOSE_POLICY);
        } else if (!protocol.canConvertToInt() || protocol.asInt() != Protocol.VERSION) {
            connection.offerFinal(ConnectionHub.control("PROTOCOL_INCOMPATIBLE"));
        } else if (connection.roomId() != null) {
            resync(connection, identity);
        } else {
            bindingOf(identity, roomId).ifPresentOrElse(
                    binding -> attach(connection, roomId, binding),
                    () -> connection.offerFinal(ConnectionHub.control("ACCESS_REVOKED")));
        }
    }

    // 세션이 이 방에 들고 있는 자리 자격을 찾고 세션이 이미 끝났으면 빈 값을 돌려준다
    private static Optional<SeatBinding> bindingOf(SessionIdentity identity, String roomId) {
        try {
            return identity.bindingIn(roomId);
        } catch (IllegalStateException sessionEnded) {
            return Optional.empty();
        }
    }

    // 방 잠금 안에서 자리와 한도를 확인하고 연결을 붙여 첫 스냅샷을 예약한다
    private void attach(Connection connection, String roomId, SeatBinding binding) {
        connection.subscribeTo(roomId);
        Subscription result;
        try {
            result = registry.update(roomId, room -> attachInRoom(room, connection, binding));
        } catch (RoomException e) {
            requireGone(e);
            connection.offerFinal(ConnectionHub.control("ROOM_GONE"));
            return;
        }
        switch (result) {
            case NO_SEAT -> connection.offerFinal(ConnectionHub.control("ACCESS_REVOKED"));
            case FULL -> connection.close(Connection.CLOSE_TRY_LATER);
            case ACCEPTED, CLOSING -> { }
        }
    }

    // 구독 판정을 내리고 받아들이면 연결을 붙인다. 호출자가 방 잠금을 잡고 있다
    private Subscription attachInRoom(Room room, Connection connection, SeatBinding binding) {
        Optional<Participant> seat = room.seatOf(binding);
        if (seat.isEmpty()) {
            return Subscription.NO_SEAT;
        }
        String participantId = seat.get().participantId();
        if (room.presence().connectionCount(participantId) >= MAX_CONNECTIONS_PER_PARTICIPANT) {
            return Subscription.FULL;
        }
        if (connection.isClosed()) {
            return Subscription.CLOSING;
        }
        RoomLifecycle.connected(room, participantId, connection.connectionId(), env);
        room.requestSnapshot(connection.connectionId());
        return Subscription.ACCEPTED;
    }

    // 방이 없다는 거절이 아니면 그대로 다시 던진다
    private static void requireGone(RoomException e) {
        if (!ErrorCode.ROOM_NOT_FOUND.name().equals(e.code())) {
            throw e;
        }
    }

    // PONG의 nonce를 연결에 넘기고 nonce가 없으면 닫는다
    private static void pong(Connection connection, JsonNode message) {
        String nonce = textOrNull(message.get("nonce"));
        if (nonce == null) {
            connection.close(Connection.CLOSE_POLICY);
        } else {
            connection.pong(nonce);
        }
    }

    // 자리 자격을 다시 확인한 뒤 버전을 올리지 않고 현재 상태를 다시 보내도록 예약한다
    private void resync(Connection connection, SessionIdentity identity) {
        String roomId = connection.roomId();
        if (roomId == null) {
            return;
        }
        Optional<SeatBinding> binding = bindingOf(identity, roomId);
        boolean seated;
        try {
            seated = registry.update(roomId, room -> requestSnapshotInRoom(room, connection, binding));
        } catch (RoomException e) {
            requireGone(e);
            connection.offerFinal(ConnectionHub.control("ROOM_GONE"));
            return;
        }
        if (!seated) {
            connection.offerFinal(ConnectionHub.control("ACCESS_REVOKED"));
        }
    }

    // 연결이 붙은 자리를 세션이 아직 들고 있으면 스냅샷을 예약한다. 호출자가 방 잠금을 잡고 있다
    private static boolean requestSnapshotInRoom(Room room, Connection connection, Optional<SeatBinding> binding) {
        String connectionId = connection.connectionId();
        String attachedTo = room.presence().subscribers().get(connectionId);
        boolean seated = binding.flatMap(room::seatOf).filter(p -> p.participantId().equals(attachedTo)).isPresent();
        if (seated) {
            room.requestSnapshot(connectionId);
        }
        return seated;
    }

    // 닫힌 연결을 목록에서 빼고 구독한 방에서 뗀다. 구독 전이면 방을 건드리지 않는다
    private void closed(Connection connection) {
        hub.unregister(connection);
        String roomId = connection.roomId();
        if (roomId == null) {
            return;
        }
        try {
            registry.update(roomId, room -> {
                RoomLifecycle.disconnected(room, connection.connectionId(), env);
                return null;
            });
        } catch (RoomException e) {
            requireGone(e);
            LOG.debug("Room {} is gone, nothing to detach", roomId);
        }
    }

    // 소켓에 묶어 둔 연결을 꺼낸다
    private static Connection connection(WebSocketSession session) {
        return (Connection) session.getAttributes().get(CONNECTION);
    }

    // 핸드셰이크 때 확인한 세션을 꺼낸다
    private static SessionIdentity identity(WebSocketSession session) {
        return WebSocketHandshakeGuard.identityOf(session.getAttributes());
    }
}
