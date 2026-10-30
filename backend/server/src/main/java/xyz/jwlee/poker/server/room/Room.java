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
    private int nextJoinOrder;
    private boolean closed;

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
    /**
     * The command ledger of one participant's control generation, created on first use. A new generation
     * starts a fresh ledger (sequence from 1), so a stale holder never shares a stream with the new one.
     */
    public RequestLedger ledger(String participantId, long controlGeneration) {
        return ledgers.computeIfAbsent(participantId + "#" + controlGeneration, k -> new RequestLedger());
    }

    /** True once the room has been emptied; a closed room is treated as not found. Set under the room lock. */
    public boolean isClosed() { return closed; }

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
        Participant p = new Participant(participantId, name, nextJoinOrder++, INITIAL_CONTROL_GENERATION);
        participants.add(p);
        if (hostId == null) {
            hostId = participantId;
        }
        bumpVersion();
        return p;
    }

    // Waiting-room mutations. They do not bump the version: the command pipeline bumps once per command.

    void replaceSettings(RoomSettings next) { this.settings = next; }

    void setHost(String participantId) { this.hostId = participantId; }

    /** The participant the dealer button points at, or null while none is chosen. */
    private String dealerId() {
        int b = settings.button();
        return b >= 0 && b < participants.size() ? participants.get(b).participantId() : null;
    }

    /** Points the button at {@code dealerId}'s current seat, or -1 when that person is gone or none was chosen. */
    private void pointDealerAt(String dealerId) {
        int seat = -1;
        for (int i = 0; dealerId != null && i < participants.size(); i++) {
            if (participants.get(i).participantId().equals(dealerId)) {
                seat = i;
            }
        }
        settings = new RoomSettings(settings.initial(), settings.sb(), settings.bb(), seat);
    }

    /** Seats the participants in {@code order} (already checked to be exactly the current ones); the dealer keeps their person. */
    void reorder(List<String> order) {
        String dealer = dealerId();
        List<Participant> next = new ArrayList<>();
        for (String id : order) {
            next.add(participant(id).orElseThrow());
        }
        participants.clear();
        participants.addAll(next);
        pointDealerAt(dealer);
    }

    void setDealer(String participantId) { pointDealerAt(participantId); }

    void rename(String participantId, String name) {
        for (int i = 0; i < participants.size(); i++) {
            Participant p = participants.get(i);
            if (p.participantId().equals(participantId)) {
                participants.set(i, new Participant(p.participantId(), name, p.joinOrder(), p.controlGeneration()));
            }
        }
    }

    /**
     * Removes a participant. The dealer stays on the same person (-1 if that was the leaver); a leaving host
     * hands the room to the earliest joiner left; the last one out closes the room.
     */
    void removeParticipant(String participantId) {
        String dealer = dealerId();
        participants.removeIf(p -> p.participantId().equals(participantId));
        ledgers.keySet().removeIf(k -> k.startsWith(participantId + "#"));
        pointDealerAt(dealer);
        if (participants.isEmpty()) {
            hostId = null;
            closed = true;
        } else if (participantId.equals(hostId)) {
            hostId = participants.stream().min(java.util.Comparator.comparingInt(Participant::joinOrder))
                    .orElseThrow().participantId();
        }
    }
}
