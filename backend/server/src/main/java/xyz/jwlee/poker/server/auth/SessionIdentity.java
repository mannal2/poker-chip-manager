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

/** The only reader and writer of the app's HttpSession attributes. */
public final class SessionIdentity {

    private static final String STREAMS = "pcm.streams";
    private static final String PARTICIPANTS = "pcm.participants";

    private final HttpSession session;

    private SessionIdentity(HttpSession session) {
        this.session = session;
    }

    public static SessionIdentity from(HttpSession session) {
        return new SessionIdentity(session);
    }

    /** The live map of this session's screen streams, each with its request ledger; synchronize on it to change it. */
    private Map<String, RequestLedger> streams() {
        return slot(STREAMS, () -> Collections.synchronizedMap(new LinkedHashMap<>()));
    }

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

    /** The ledger of a registered stream; UNKNOWN_STREAM when this session never opened it. */
    public RequestLedger ledgerFor(String streamId) {
        RequestLedger ledger = streams().get(streamId);
        if (ledger == null) {
            throw new RoomException("UNKNOWN_STREAM");
        }
        return ledger;
    }

    public Optional<String> participantIn(String roomId) {
        return Optional.ofNullable(participants().get(roomId));
    }

    public void bind(String roomId, String participantId) {
        participants().put(roomId, participantId);
    }

    public void unbind(String roomId) {
        participants().remove(roomId);
    }

    private Map<String, String> participants() {
        return slot(PARTICIPANTS, ConcurrentHashMap::new);
    }

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
