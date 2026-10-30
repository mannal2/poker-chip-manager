package xyz.jwlee.poker.server.room;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantLock;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;

/**
 * Everything about one room. Not thread-safe by itself: every read or write of the mutable state
 * happens while {@link #lock()} is held (see {@code RoomRegistry.withRoom}). The lock order is always
 * the registry global lock first, then a room lock, never the reverse.
 */
public final class Room {

    public static final int MAX_PARTICIPANTS = 10;
    public static final int INITIAL_CONTROL_GENERATION = 1;

    private final String roomId;
    private final String code;
    private final Instant createdAt;
    private final ReentrantLock lock = new ReentrantLock();

    private RoomPhase phase = RoomPhase.WAITING;
    private long version;
    private final List<Participant> participants = new ArrayList<>();
    private String hostId;
    private RoomSettings settings = RoomSettings.defaults();
    private RoomSettings lastStartSettings;
    private GameState game;
    private final Map<String, String> playerIds = new HashMap<>();
    private final List<GameEvent> events = new ArrayList<>();
    private SettlementDraft settlementDraft;
    private final Map<String, RequestLedger> ledgers = new HashMap<>();

    public Room(String roomId, String code, Instant createdAt) {
        this.roomId = roomId;
        this.code = code;
        this.createdAt = createdAt;
    }

    public String roomId() { return roomId; }
    public String code() { return code; }
    public Instant createdAt() { return createdAt; }
    public ReentrantLock lock() { return lock; }

    public RoomPhase phase() { return phase; }
    public void setPhase(RoomPhase phase) { this.phase = phase; bumpVersion(); }

    public long version() { return version; }
    /** The state version only ever grows. */
    public long bumpVersion() { return ++version; }

    public List<Participant> participants() { return List.copyOf(participants); }
    public String hostId() { return hostId; }
    public RoomSettings settings() { return settings; }
    public RoomSettings lastStartSettings() { return lastStartSettings; }
    public GameState game() { return game; }
    public Map<String, String> playerIds() { return playerIds; }
    public List<GameEvent> events() { return events; }
    public SettlementDraft settlementDraft() { return settlementDraft; }
    /** Ledgers by stream and control generation, created on first use. */
    public RequestLedger ledger(String key) { return ledgers.computeIfAbsent(key, k -> new RequestLedger()); }

    public Optional<Participant> participant(String participantId) {
        return participants.stream().filter(p -> p.participantId().equals(participantId)).findFirst();
    }

    public boolean hasParticipant(String participantId) {
        return participant(participantId).isPresent();
    }

    public boolean isHost(String participantId) {
        return participantId.equals(hostId);
    }

    /**
     * Seats a new participant (the first one becomes the host). The name must already follow the name rule;
     * duplicates are compared case-insensitively.
     */
    public Participant addParticipant(String participantId, String name) {
        if (phase != RoomPhase.WAITING) {
            throw new RoomException("NOT_WAITING");
        }
        if (participants.size() >= MAX_PARTICIPANTS) {
            throw new RoomException("ROOM_FULL");
        }
        String lowered = name.toLowerCase(Locale.ROOT);
        if (participants.stream().anyMatch(p -> p.name().toLowerCase(Locale.ROOT).equals(lowered))) {
            throw new RoomException("DUPLICATE_NAME");
        }
        Participant p = new Participant(participantId, name, participants.size(), INITIAL_CONTROL_GENERATION);
        participants.add(p);
        if (hostId == null) {
            hostId = participantId;
        }
        bumpVersion();
        return p;
    }
}
