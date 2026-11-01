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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import xyz.jwlee.poker.server.room.Participant;
import xyz.jwlee.poker.server.room.Publication;
import xyz.jwlee.poker.server.room.PublicationBuilder;
import xyz.jwlee.poker.server.room.Room;
import xyz.jwlee.poker.server.room.RoomEnv;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.room.RoomLifecycle;
import xyz.jwlee.poker.server.room.RoomPublisher;
import xyz.jwlee.poker.server.room.SeatBinding;
import xyz.jwlee.poker.server.support.IdGenerator;

// 활성 방을 보관하고 전역 잠금과 방 잠금으로 접근을 조율하는 저장소
/**
 * All active rooms (waiting, playing and result), with a configurable limit (default {@value #MAX_ROOMS}).
 *
 * <p>Locking: one global lock guards the room table and the code index; each room has its own lock.
 * The order is always global then room, never the reverse. {@link #update} and {@link #withRoom} hold only the
 * room lock while their action runs, so that action must not call anything that takes the global lock.
 *
 * <p>Changing a room: every path that changes a room goes through {@link #update} (create and join do the same
 * work themselves); {@link #withRoom} is for reading. The action and {@code PublicationBuilder.collect} run under
 * the room lock, and the publication goes out after that lock is released.
 *
 * <p>Deleting a room: the decision is made under the room lock ({@code Room.removeParticipant} sets the closed
 * flag when the last person leaves, {@code RoomLifecycle.sweep} when a room is abandoned), the room lock is
 * released, and only then {@link #remove} takes the global lock.
 * No thread ever holds a room lock while waiting for the global one, so the order stays global then room.
 * Between the close and the removal the room is still in the table but {@link #update}, {@link #withRoom} and
 * {@link #join} see the closed flag under the room lock and answer ROOM_NOT_FOUND, so nobody can be seated in a
 * room that is about to disappear.
 */
@Component
public class RoomRegistry {

    public static final int MAX_ROOMS = 10;

    private static final Logger LOG = LoggerFactory.getLogger(RoomRegistry.class);

    // 생성/입장 결과(방, 코드, 참가자, 상태 버전)
    /** Where a participant ended up after create or join. */
    public record Entry(String roomId, String code, String participantId, long stateVersion) { }

    // 방 생성 결과와 공용 잠금을 푼 뒤 넘길 알림
    private record Created(Entry entry, Publication publication) { }

    private final ReentrantLock global = new ReentrantLock();
    private final Map<String, Room> rooms = new HashMap<>();
    private final Map<String, Room> byCode = new HashMap<>();
    private final IdGenerator ids;
    private final Clock clock;
    private final RoomPublisher publisher;
    private final RoomCodes codes;
    private final int maxRooms;

    // 방 레지스트리를 만든다
    public RoomRegistry(IdGenerator ids, Clock clock, RoomPublisher publisher) {
        this(ids, clock, publisher, MAX_ROOMS);
    }

    // 설정한 최대 방 수로 레지스트리를 만든다
    @Autowired
    public RoomRegistry(IdGenerator ids, Clock clock, RoomPublisher publisher,
            @Value("${poker.max-rooms:10}") int maxRooms) {
        this.maxRooms = maxRooms;
        this.ids = ids;
        this.clock = clock;
        this.publisher = publisher;
        this.codes = new RoomCodes();
    }

    // 전역 잠금을 잡고 작업을 실행한다
    public <T> T withGlobal(Supplier<T> action) {
        global.lock();
        try {
            return action.get();
        } finally {
            global.unlock();
        }
    }

    // 방장 이름으로 새 방을 만든다
    /** Creates a room with {@code hostName} (already normalized) as host, or refuses with ROOM_LIMIT. */
    public Entry create(String hostName) {
        return create(hostName, (roomId, participantId) -> { });
    }

    // 새 방을 만들고 방장 착석 직후 잠금 안에서 세션 연결을 실행한다
    /**
     * Like {@link #create(String)}; {@code bind} runs under the locks, right after the host is seated, so a
     * caller can attach the new seat's binding to its session atomically (the session monitor is a leaf lock).
     */
    public Entry create(String hostName, BiConsumer<String, SeatBinding> bind) {
        Created created = withGlobal(() -> {
            if (rooms.size() >= maxRooms) {
                throw new RoomException("ROOM_LIMIT");
            }
            Room room = new Room(ids.next(), codes.next(byCode.keySet()), clock.instant());
            String participantId = ids.next();
            String credential = ids.next();
            room.lock().lock();
            try {
                room.addParticipant(participantId, hostName, credential, clock.instant());
                rooms.put(room.roomId(), room);
                byCode.put(room.code(), room);
                bind.accept(room.roomId(), new SeatBinding(participantId, credential));
                Entry entry = new Entry(room.roomId(), room.code(), participantId, room.version());
                return new Created(entry, PublicationBuilder.collect(room));
            } finally {
                room.lock().unlock();
            }
        });
        publish(created.publication());
        return created.entry();
    }

    // 방 코드로 새 참가자를 입장시킨다
    public Entry join(String code, String name) {
        return join(code, name, roomId -> Optional.empty(), (roomId, participantId) -> { }, n -> n);
    }

    // 세션의 자격이 아직 여는 자리가 있으면 그대로 돌려주고 아니면 새 참가자로 앉힌다
    /**
     * Looks the room up by code under the global lock, then, under the room lock, either returns the
     * seat the caller's binding still opens in this room (any phase, {@code name} ignored, never
     * validated) or seats a new one under {@code nameRule}, which throws for an invalid name. {@code existing} and {@code bind} run inside the room lock, so the check and the binding are
     * atomic for one session.
     */
    public Entry join(String code, String name, Function<String, Optional<SeatBinding>> existing,
            BiConsumer<String, SeatBinding> bind, UnaryOperator<String> nameRule) {
        Room room = RoomCodes.normalize(code).flatMap(this::findByCode)
                .orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
        return change(room, r -> {
            Optional<Participant> seat = existing.apply(r.roomId()).flatMap(r::seatOf);
            if (seat.isPresent()) {
                return new Entry(r.roomId(), r.code(), seat.get().participantId(), r.version());
            }
            String participantId = ids.next();
            String credential = ids.next();
            r.addParticipant(participantId, nameRule.apply(name), credential, clock.instant());
            bind.accept(r.roomId(), new SeatBinding(participantId, credential));
            return new Entry(r.roomId(), r.code(), participantId, r.version());
        });
    }

    // 방 코드로 방을 찾는다
    public Optional<Room> findByCode(String code) {
        return withGlobal(() -> Optional.ofNullable(byCode.get(code)));
    }

    // 방을 바꾸고 변경을 수집한 뒤, 잠금을 풀고 알림과 닫힌 방 제거를 한다
    /**
     * Runs {@code action} holding the room lock, then collects what changed; ROOM_NOT_FOUND when the room is gone.
     * An action that fails after changing the room still has that change collected, so it is neither lost nor left
     * for a later update to announce, and a room it closed still leaves the table.
     */
    public <T> T update(String roomId, Function<Room, T> action) {
        return change(existing(roomId), action);
    }

    // 잠금 안의 작업과 수집, 잠금 밖의 알림과 제거를 순서대로 실행한다
    private <T> T change(Room room, Function<Room, T> action) {
        Publication publication = null;
        boolean closed = false;
        room.lock().lock();
        try {
            requireOpen(room);
            try {
                return action.apply(room);
            } finally {
                closed = room.isClosed();
                publication = PublicationBuilder.collect(room);
            }
        } finally {
            room.lock().unlock();
            if (publication != null) {
                publish(publication);
            }
            if (closed) {
                remove(room.roomId());
            }
        }
    }

    // 알림이 있으면 넘기고, 넘기다 실패해도 이미 끝난 게임 변경에는 영향을 주지 않는다
    private void publish(Publication publication) {
        if (publication.isEmpty()) {
            return;
        }
        try {
            publisher.publish(publication);
        } catch (RuntimeException e) {
            LOG.error("Publishing a room update failed", e);
        }
    }

    // 방 잠금을 잡고 읽기 작업을 실행하며 없는 방이면 예외를 던진다
    /** Runs {@code action}, which must only read, holding the room lock; ROOM_NOT_FOUND when the room is gone. */
    public <T> T withRoom(String roomId, Function<Room, T> action) {
        Room room = existing(roomId);
        room.lock().lock();
        try {
            requireOpen(room);
            return action.apply(room);
        } finally {
            room.lock().unlock();
        }
    }

    // 표에 있는 방을 찾고 없으면 예외를 던진다
    private Room existing(String roomId) {
        Room room = withGlobal(() -> rooms.get(roomId));
        if (room == null) {
            throw new RoomException("ROOM_NOT_FOUND");
        }
        return room;
    }

    // 닫힌 방이면 없는 방으로 답한다. 호출자가 방 잠금을 잡고 있다
    private static void requireOpen(Room room) {
        if (room.isClosed()) {
            throw new RoomException("ROOM_NOT_FOUND");
        }
    }

    // 방을 목록과 코드 색인에서 제거한다
    public void remove(String roomId) {
        withGlobal(() -> {
            Room room = rooms.remove(roomId);
            if (room != null) {
                byCode.remove(room.code());
            }
            return null;
        });
    }

    // 방마다 시간 규칙을 판정한다
    /** Each room is swept through {@link #update}; one room's failure is logged and the others still run. */
    public void sweepAll() {
        RoomEnv env = new RoomEnv(clock, ids);
        for (String roomId : roomIds()) {
            sweep(roomId, env);
        }
    }

    // 방 하나를 점검한다. 목록을 읽은 뒤 사라진 방은 건너뛴다
    /**
     * The sweep's own refusals are wrapped, so that the {@link RoomException} caught here can only be
     * {@link #update} saying the room is gone, never a rule failing with the same code.
     */
    private void sweep(String roomId, RoomEnv env) {
        try {
            update(roomId, room -> {
                try {
                    RoomLifecycle.sweep(room, env);
                } catch (RoomException e) {
                    throw new IllegalStateException(e);
                }
                return null;
            });
        } catch (RoomException gone) {
            LOG.debug("Room {} is gone, nothing to sweep", roomId);
        } catch (RuntimeException e) {
            LOG.error("Room sweep failed for {}", roomId, e);
        }
    }

    // 활성 방의 개수를 돌려준다
    public int size() {
        return withGlobal(rooms::size);
    }

    // 활성 방 id 목록의 복사본을 돌려준다
    public List<String> roomIds() {
        return withGlobal(() -> List.copyOf(rooms.keySet()));
    }
}
