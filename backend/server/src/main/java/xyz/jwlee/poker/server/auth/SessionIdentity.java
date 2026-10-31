package xyz.jwlee.poker.server.auth;

import jakarta.servlet.http.HttpSession;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import xyz.jwlee.poker.server.room.RequestLedger;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.SeatBinding;

// HttpSession의 화면 스트림별 요청 원장, 방별 자리 자격, 복구 신청을 읽고 쓰는 역할을 전담한다
/** The only reader and writer of the app's HttpSession attributes. */
public final class SessionIdentity {

    private static final String STREAMS = "pcm.streams";
    private static final String PARTICIPANTS = "pcm.participants";
    private static final String RECOVERIES = "pcm.recoveries";

    private final HttpSession session;

    private SessionIdentity(HttpSession session) {
        this.session = session;
    }

    // 세션을 감싼 SessionIdentity를 만든다
    public static SessionIdentity from(HttpSession session) {
        return new SessionIdentity(session);
    }

    // 이 세션의 화면 스트림별 요청 원장 맵을 돌려준다
    /** The live map of this session's screen streams, each with its request ledger; synchronize on it to change it. */
    private Map<String, RequestLedger> streams() {
        return slot(STREAMS, () -> Collections.synchronizedMap(new LinkedHashMap<>()));
    }

    // 세션의 id를 돌려준다
    public String id() {
        return session.getId();
    }

    // 새 스트림과 요청 원장을 등록하고 한도 초과 시 거절한다
    /** Registers a stream with a fresh ledger unless the session already has {@code max}; false when refused. */
    public boolean openStream(String streamId, int max) {
        Map<String, RequestLedger> streams = streams();
        synchronized (streams) {
            if (streams.size() >= max || streams.containsKey(streamId)) {
                return false;
            }
            streams.put(streamId, new RequestLedger());
            return true;
        }
    }

    // 스트림과 그 요청 원장을 지운다. 없는 스트림이면 아무 일도 하지 않는다
    public void closeStream(String streamId) {
        streams().remove(streamId);
    }

    // 등록된 스트림의 요청 원장을 돌려준다
    /** The ledger of a registered stream; UNKNOWN_STREAM when this session never opened it. */
    public RequestLedger ledgerFor(String streamId) {
        RequestLedger ledger = streams().get(streamId);
        if (ledger == null) {
            throw new RoomException("UNKNOWN_STREAM");
        }
        return ledger;
    }

    // 이 세션이 해당 방에서 들고 있는 자리 자격을 찾는다
    /** What this session holds for the room; whether it still opens a seat is for {@code Room.seatOf} to say. */
    public Optional<SeatBinding> bindingIn(String roomId) {
        return Optional.ofNullable(participants().get(roomId));
    }

    // 이 세션의 방별 자리 자격을 저장한다
    public void bind(String roomId, SeatBinding binding) {
        participants().put(roomId, binding);
    }

    // 세션과 방의 참가자 연결을 해제한다
    public void unbind(String roomId) {
        participants().remove(roomId);
    }

    // 이 세션이 만든 복구 신청과 그 방을 기억한다
    public void rememberRecovery(String recoveryRequestId, String roomId) {
        recoveries().put(recoveryRequestId, roomId);
    }

    // 이 세션이 만든 복구 신청의 방을 찾는다
    public Optional<String> recoveryRoom(String recoveryRequestId) {
        return Optional.ofNullable(recoveries().get(recoveryRequestId));
    }

    // 사라진 복구 신청을 잊는다
    public void forgetRecovery(String recoveryRequestId) {
        recoveries().remove(recoveryRequestId);
    }

    // 방별 자리 자격 맵을 돌려준다
    private Map<String, SeatBinding> participants() {
        return slot(PARTICIPANTS, ConcurrentHashMap::new);
    }

    // 복구 신청 id에서 방 id로 가는 맵을 돌려준다
    private Map<String, String> recoveries() {
        return slot(RECOVERIES, ConcurrentHashMap::new);
    }

    // 세션 속성을 읽고 없으면 만들어 저장한다
    @SuppressWarnings("unchecked")
    private <T> T slot(String name, Supplier<T> create) {
        synchronized (session) {
            Object v = session.getAttribute(name);
            if (v == null) {
                v = create.get();
                session.setAttribute(name, v);
            }
            return (T) v;
        }
    }
}
