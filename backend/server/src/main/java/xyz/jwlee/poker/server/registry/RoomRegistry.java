package xyz.jwlee.poker.server.registry;

import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Function;
import java.util.function.Supplier;
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
 */
@Component
public class RoomRegistry {

    public static final int MAX_ROOMS = 10;

    /** Where a participant ended up after create or join. */
    public record Entry(String roomId, String code, String participantId) { }

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
        return withGlobal(() -> {
            if (rooms.size() >= MAX_ROOMS) {
                throw new RoomException("ROOM_LIMIT");
            }
            Room room = new Room(ids.next(), codes.next(byCode.keySet()), clock.instant());
            String participantId = ids.next();
            room.lock().lock();
            try {
                room.addParticipant(participantId, hostName);
            } finally {
                room.lock().unlock();
            }
            rooms.put(room.roomId(), room);
            byCode.put(room.code(), room);
            return new Entry(room.roomId(), room.code(), participantId);
        });
    }

    /** Looks the room up by code under the global lock, then seats the guest under the room lock. */
    public Entry join(String code, String name) {
        Room room = RoomCodes.normalize(code).flatMap(this::findByCode)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        String participantId = ids.next();
        room.lock().lock();
        try {
            room.addParticipant(participantId, name);
        } finally {
            room.lock().unlock();
        }
        return new Entry(room.roomId(), room.code(), participantId);
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
