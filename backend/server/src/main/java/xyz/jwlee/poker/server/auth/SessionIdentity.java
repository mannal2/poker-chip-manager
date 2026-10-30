package xyz.jwlee.poker.server.auth;

import jakarta.servlet.http.HttpSession;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/** The only reader and writer of the app's HttpSession attributes. */
final class SessionIdentity {

    private static final String STREAMS = "pcm.streams";
    // TODO(Task 4/5): each screen stream also holds a RequestLedger beside its id (ledgerFor(streamId)).
    private static final String PARTICIPANTS = "pcm.participants";

    private final HttpSession session;

    private SessionIdentity(HttpSession session) {
        this.session = session;
    }

    static SessionIdentity from(HttpSession session) {
        return new SessionIdentity(session);
    }

    /** The live set of this session's active screen stream ids; synchronize on it to change it. */
    Set<String> streams() {
        return slot(STREAMS, () -> Collections.synchronizedSet(new LinkedHashSet<>()));
    }

    /** Adds a stream unless the session already has {@code max}; false when refused. */
    boolean openStream(String streamId, int max) {
        Set<String> streams = streams();
        synchronized (streams) {
            if (streams.size() >= max) {
                return false;
            }
            return streams.add(streamId);
        }
    }

    Optional<String> participantIn(String roomId) {
        return Optional.ofNullable(participants().get(roomId));
    }

    void bind(String roomId, String participantId) {
        participants().put(roomId, participantId);
    }

    void unbind(String roomId) {
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
