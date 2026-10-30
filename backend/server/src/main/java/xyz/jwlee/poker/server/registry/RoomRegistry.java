package xyz.jwlee.poker.server.registry;

import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.function.UnaryOperator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.support.IdGenerator;

/**
 * All active rooms (waiting, playing and result), at most {@value #MAX_ROOMS}.
 *
 * <p>Locking: one global lock guards the room table and the code index; each room has its own lock.
 * The order is always global then room, never the reverse. {@link #withRoom} holds only the room lock
 * while its action runs, so that action must not call anything that takes the global lock.
 *
 * <p>Deleting a room: the decision is made under the room lock (the last person leaving calls
 * {@code Room.close()}), the room lock is released, and only then {@link #remove} takes the global lock.
 * No thread ever holds a room lock while waiting for the global one, so the order stays global then room.
 * Between the close and the removal the room is still in the table but {@link #withRoom} and {@link #join}
 * see the closed flag under the room lock and answer ROOM_NOT_FOUND, so nobody can be seated in a room that
 * is about to disappear.
 */
@Component
public class RoomRegistry {

    public static final int MAX_ROOMS = 10;

    /** Where a participant ended up after create or join. */
    public record Entry(String roomId, String code, String participantId, long stateVersion) { }

    private final ReentrantLock global = new ReentrantLock();
    private final Map<String, Room> rooms = new HashMap<>();
    private final Map<String, Room> byCode = new HashMap<>();
    private final IdGenerator ids;
    private final Clock clock;
    private final RoomCodes codes;

    @Autowired
    public RoomRegistry(IdGenerator ids, Clock clock) {
        this(ids, clock, new RoomCodes());
    }

    RoomRegistry(IdGenerator ids, Clock clock, RoomCodes codes) {
        this.ids = ids;
        this.clock = clock;
        this.codes = codes;
    }

    public <T> T withGlobal(Supplier<T> action) {
        global.lock();
        try {
            return action.get();
        } finally {
            global.unlock();
        }
    }

    /** Creates a room with {@code hostName} (already normalized) as host, or refuses with ROOM_LIMIT. */
    public Entry create(String hostName) {
        return create(hostName, (roomId, participantId) -> { });
    }

    /**
     * Like {@link #create(String)}; {@code bind} runs under the locks, right after the host is seated, so a
     * caller can attach the new participant to its session atomically (the session monitor is a leaf lock).
     */
    public Entry create(String hostName, BiConsumer<String, String> bind) {
        return withGlobal(() -> {
            if (rooms.size() >= MAX_ROOMS) {
                throw new RoomException("ROOM_LIMIT");
            }
            Room room = new Room(ids.next(), codes.next(byCode.keySet()), clock.instant());
            String participantId = ids.next();
            room.lock().lock();
            try {
                room.addParticipant(participantId, hostName);
                rooms.put(room.roomId(), room);
                byCode.put(room.code(), room);
                bind.accept(room.roomId(), participantId);
                return new Entry(room.roomId(), room.code(), participantId, room.version());
            } finally {
                room.lock().unlock();
            }
        });
    }

    public Entry join(String code, String name) {
        return join(code, name, roomId -> Optional.empty(), (roomId, participantId) -> { }, n -> n);
    }

    /**
     * Looks the room up by code under the global lock, then, under the room lock, either returns the
     * participant the caller is already bound to in this room (any phase, {@code name} ignored, never
     * validated) or seats a new one under {@code nameRule}, which throws for an invalid name. {@code existing} and {@code bind} run inside the room lock, so the check and the binding are
     * atomic for one session.
     */
    public Entry join(String code, String name, Function<String, Optional<String>> existing,
            BiConsumer<String, String> bind, UnaryOperator<String> nameRule) {
        Room room = RoomCodes.normalize(code).flatMap(this::findByCode)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        room.lock().lock();
        try {
            if (room.isClosed()) {
                throw new RoomException("ROOM_NOT_FOUND");
            }
            Optional<String> bound = existing.apply(room.roomId()).filter(room::hasParticipant);
            if (bound.isPresent()) {
                return new Entry(room.roomId(), room.code(), bound.get(), room.version());
            }
            String participantId = ids.next();
            room.addParticipant(participantId, nameRule.apply(name));
            bind.accept(room.roomId(), participantId);
            return new Entry(room.roomId(), room.code(), participantId, room.version());
        } finally {
            room.lock().unlock();
        }
    }

    public Optional<Room> findByCode(String code) {
        return withGlobal(() -> Optional.ofNullable(byCode.get(code)));
    }

    /** Runs {@code action} holding the room lock; ROOM_NOT_FOUND when the room is gone. */
    public <T> T withRoom(String roomId, Function<Room, T> action) {
        Room room = withGlobal(() -> rooms.get(roomId));
        if (room == null) {
            throw new RoomException("ROOM_NOT_FOUND");
        }
        room.lock().lock();
        try {
            if (room.isClosed()) {
                throw new RoomException("ROOM_NOT_FOUND");
            }
            return action.apply(room);
        } finally {
            room.lock().unlock();
        }
    }

    public void remove(String roomId) {
        withGlobal(() -> {
            Room room = rooms.remove(roomId);
            if (room != null) {
                byCode.remove(room.code());
            }
            return null;
        });
    }

    public int size() {
        return withGlobal(rooms::size);
    }

    public List<String> roomIds() {
        return withGlobal(() -> List.copyOf(rooms.keySet()));
    }
}
