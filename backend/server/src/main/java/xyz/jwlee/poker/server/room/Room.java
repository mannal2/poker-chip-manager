package xyz.jwlee.poker.server.room;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.locks.ReentrantLock;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameState;

// 방 하나의 참가자, 설정, 게임, 요청 원장 등 모든 상태를 담는다
/**
 * Everything about one room. Not thread-safe by itself: every read or write of the mutable state
 * happens while {@link #lock()} is held (see {@code RoomRegistry.update} and {@code withRoom}). The lock order is always
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
    private long draftVersion;
    private final Map<String, RequestLedger> ledgers = new HashMap<>();
    private int nextJoinOrder;
    private boolean closed;
    private final Presence presence = new Presence();
    private final RecoveryRequests recoveryRequests = new RecoveryRequests();
    private boolean hostTakeoverOpen;
    private boolean deployPending;
    private final List<String> pendingRevocations = new ArrayList<>();
    private final Set<String> snapshotRequests = new HashSet<>();
    private long collectedVersion;
    private long collectedDraftVersion;
    private int collectedEventCount;

    public Room(String roomId, String code, Instant createdAt) {
        this.roomId = roomId;
        this.code = code;
        this.createdAt = createdAt;
    }

    public String roomId() { return roomId; }
    public String code() { return code; }
    public Instant createdAt() { return createdAt; }
    public ReentrantLock lock() { return lock; }
    // 방의 접속 상태 추적기를 돌려준다
    public Presence presence() { return presence; }
    // 방의 복구 요청 목록을 돌려준다
    public RecoveryRequests recoveryRequests() { return recoveryRequests; }

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
    // 방에 쌓인 게임 이벤트 목록을 돌려준다
    public List<GameEvent> events() { return events; }
    // 진행 중인 승자 초안을 돌려준다
    public SettlementDraft settlementDraft() { return settlementDraft; }
    // 지금까지 저장한 승자 초안의 마지막 버전을 돌려준다
    public long draftVersion() { return draftVersion; }
    // 참가자의 조작권 세대별 요청 원장을 돌려주고 없으면 만든다
    /**
     * The command ledger of one participant's control generation, created on first use. A new generation
     * starts a fresh ledger (sequence from 1), so a stale holder never shares a stream with the new one.
     */
    public RequestLedger ledger(String participantId, long controlGeneration) {
        return ledgers.computeIfAbsent(participantId + "#" + controlGeneration, k -> new RequestLedger());
    }

    // 이미 있는 원장만 조회하고 새로 만들지 않는다
    /** The ledger of a generation that has one. Read-only: a number from a request never creates a ledger. */
    public Optional<RequestLedger> existingLedger(String participantId, long controlGeneration) {
        return Optional.ofNullable(ledgers.get(participantId + "#" + controlGeneration));
    }

    // 현재 또는 직전 조작권 세대의 원장에서 요청 결과를 찾는다
    /**
     * The stored result of a participant's request in the current generation or, failing that, the one before
     * it: only those two keep a ledger (see {@link #advanceControl}). Creates no ledger.
     */
    public Optional<RequestOutcome> findRequest(Participant participant, String requestId) {
        String id = participant.participantId();
        long current = participant.controlGeneration();
        return existingLedger(id, current).flatMap(ledger -> ledger.find(requestId))
                .or(() -> existingLedger(id, current - 1).flatMap(ledger -> ledger.find(requestId)));
    }

    // 방이 비워져 닫혔는지 돌려준다
    /** True once the room has been emptied; a closed room is treated as not found. Set under the room lock. */
    public boolean isClosed() { return closed; }

    // 방을 닫는다. 표에서 빼는 일은 호출자가 방 잠금을 푼 뒤에 한다
    void close() { this.closed = true; }

    // 방장 인계가 열려 있는지 돌려준다
    public boolean hostTakeoverOpen() { return hostTakeoverOpen; }
    // 방장 인계를 연다
    void openHostTakeover() { this.hostTakeoverOpen = true; }
    // 방장 인계를 닫는다
    void closeHostTakeover() { this.hostTakeoverOpen = false; }

    // 배포 안내가 켜져 있는지 돌려준다
    public boolean deployPending() { return deployPending; }

    // 배포 안내를 바꾸고 값이 달라졌을 때만 상태 버전을 올린다
    /** The flag moves with the version, so a screen never holds an old value at the newest version. */
    public void showDeployPending(boolean pending) {
        if (deployPending != pending) {
            deployPending = pending;
            bumpVersion();
        }
    }

    // 명단에서 빠진 사람의 끊어야 할 연결 ID를 꺼내고 목록을 비운다
    public List<String> drainPendingRevocations() {
        List<String> drained = List.copyOf(pendingRevocations);
        pendingRevocations.clear();
        return drained;
    }

    // 버전 변화 없이 다음 수집에서 이 연결에 현재 상태를 보내도록 표시한다
    public void requestSnapshot(String connectionId) {
        snapshotRequests.add(connectionId);
    }

    // 참가자의 모든 구독 연결에 버전 변화 없이 현재 상태를 보내도록 표시한다
    void requestSnapshotsOf(String participantId) {
        presence.subscribers().forEach((connectionId, subscriber) -> {
            if (subscriber.equals(participantId)) {
                snapshotRequests.add(connectionId);
            }
        });
    }

    // 이 연결이 스냅샷을 요청했는지 확인한다
    boolean snapshotRequested(String connectionId) {
        return snapshotRequests.contains(connectionId);
    }

    // 처리한 스냅샷 요청을 비운다
    void clearSnapshotRequests() {
        snapshotRequests.clear();
    }

    // 지난 수집 뒤 상태 버전이나 초안 버전이 움직였는지 확인한다
    boolean changedSinceCollect() {
        return version != collectedVersion || draftVersion != collectedDraftVersion;
    }

    // 지난 수집 때의 상태 버전을 돌려준다
    long collectedVersion() { return collectedVersion; }

    // 지난 수집까지 내보낸 이벤트 개수를 돌려준다
    int collectedEventCount() { return collectedEventCount; }

    // 수집 위치를 현재 상태로 옮긴다
    void markCollected() {
        collectedVersion = version;
        collectedDraftVersion = draftVersion;
        collectedEventCount = events.size();
    }

    // id로 참가자를 찾는다
    public Optional<Participant> participant(String participantId) {
        return participants.stream().filter(p -> p.participantId().equals(participantId)).findFirst();
    }

    // 세션의 자격이 아직 이 자리를 여는지 명단과 credential을 함께 확인한다
    /** The one check of a session's right to a seat: on the roster and holding the seat's current credential. */
    public Optional<Participant> seatOf(SeatBinding binding) {
        return participant(binding.participantId()).filter(p -> p.credential().equals(binding.credential()));
    }

    // 명단에 있는지만 본다. 세션의 자리 확인에는 seatOf를 쓴다
    public boolean hasParticipant(String participantId) {
        return participant(participantId).isPresent();
    }

    public boolean isHost(String participantId) {
        return participantId.equals(hostId);
    }

    // 현재 토너먼트에 등록된 참가자 중 방의 참가자 명단에서 빠진 사람이 있는지 확인한다
    boolean hasPlayerLeft() {
        return playerIds.keySet().stream().anyMatch(id -> !hasParticipant(id));
    }

    // 대기실에 새 참가자를 앉히고 첫 참가자를 방장으로 정한다
    /**
     * Seats a new participant (the first one becomes the host). The name must already follow the name rule;
     * duplicates are compared case-insensitively.
     */
    public Participant addParticipant(String participantId, String name, String credential, Instant now) {
        if (phase != RoomPhase.WAITING) {
            throw new RoomException(ErrorCode.NOT_WAITING);
        }
        if (participants.size() >= MAX_PARTICIPANTS) {
            throw new RoomException(ErrorCode.ROOM_FULL);
        }
        String lowered = name.toLowerCase(Locale.ROOT);
        if (participants.stream().anyMatch(p -> p.name().toLowerCase(Locale.ROOT).equals(lowered))) {
            throw new RoomException(ErrorCode.DUPLICATE_NAME);
        }
        Participant p = new Participant(participantId, name, nextJoinOrder++, INITIAL_CONTROL_GENERATION, credential);
        participants.add(p);
        presence.joined(participantId, now);
        if (hostId == null) {
            hostId = participantId;
        }
        bumpVersion();
        return p;
    }

    // Waiting-room mutations. They do not bump the version: the command pipeline bumps once per command.

    void replaceSettings(RoomSettings next) { this.settings = next; }

    // 방장을 바꾸고 정산 초안을 비우며 인수 요청을 닫는다
    /** A new host starts from a clean draft: the old host's pick is not theirs to apply. */
    void setHost(String participantId) {
        this.hostId = participantId;
        this.settlementDraft = null;
        this.hostTakeoverOpen = false;
    }

    // Game mutations. Like the waiting-room ones, they leave the version to the command pipeline.

    // 새 토너먼트를 시작하며 이전 게임의 이벤트와 초안을 지운다
    /** Seats a fresh tournament: the previous tournament's events are dropped. */
    void beginGame(GameState state, Map<String, String> playerIdsByParticipant, RoomSettings startedWith) {
        this.game = state;
        this.playerIds.clear();
        this.playerIds.putAll(playerIdsByParticipant);
        this.events.clear();
        this.collectedEventCount = 0;
        this.settlementDraft = null;
        this.lastStartSettings = startedWith;
    }

    // 대기실로 돌아가며 게임 관련 상태를 지우고, 시작 칩과 블라인드는 이번 토너먼트의 시작 설정으로 되돌리되 딜러는 미지정으로 바꾼다
    /**
     * Leaves the result screen: the game, its events, player ids and settlement draft go, the settings return to
     * what the tournament started with and the dealer is unchosen. The draft counter keeps growing, and the
     * version is left to the command pipeline.
     */
    void returnToWaiting() {
        if (lastStartSettings != null) {
            this.settings = new RoomSettings(lastStartSettings.initial(), lastStartSettings.sb(),
                    lastStartSettings.bb(), -1);
        }
        this.game = null;
        this.playerIds.clear();
        this.events.clear();
        this.collectedEventCount = 0;
        this.settlementDraft = null;
        this.phase = RoomPhase.WAITING;
    }

    // 게임 상태를 바꾸고 이벤트를 덧붙이며 게임 상태에 따라 방 단계를 정한다
    /** Replaces the game state and appends the engine's events in order; the phase follows the game status. */
    void updateGame(GameState state, List<GameEvent> appended) {
        this.game = state;
        this.events.addAll(appended);
        this.phase = switch (state.status) {
            case ENDED, ABORTED -> RoomPhase.RESULT;
            default -> RoomPhase.PLAYING;
        };
    }

    // 방장의 정산 선택 초안을 새 버전으로 저장한다
    /** Stores the host's draft; its version only ever grows, also across clears. */
    void saveDraft(int potIndex, Map<String, List<String>> winners) {
        this.settlementDraft = new SettlementDraft(++draftVersion, potIndex, winners);
    }

    void clearDraft() { this.settlementDraft = null; }

    // 딜러 버튼이 가리키는 참가자 id를 돌려준다
    /** The participant the dealer button points at, or null while none is chosen. */
    private String dealerId() {
        int b = settings.button();
        return b >= 0 && b < participants.size() ? participants.get(b).participantId() : null;
    }

    // 참가자의 현재 좌석으로 딜러 버튼을 다시 맞춘다
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

    // 참가자 좌석 순서를 바꾸되 딜러는 같은 사람을 유지한다
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

    // 딜러 위치를 지정한 참가자로 옮긴다
    void setDealer(String participantId) { pointDealerAt(participantId); }

    // 참가자의 이름을 바꾼다
    void rename(String participantId, String name) {
        for (int i = 0; i < participants.size(); i++) {
            Participant p = participants.get(i);
            if (p.participantId().equals(participantId)) {
                participants.set(i, new Participant(
                        p.participantId(), name, p.joinOrder(), p.controlGeneration(), p.credential()));
            }
        }
    }

    // 참가자의 조작권 세대를 올리고 오래된 원장을 정리한다
    /**
     * Moves a participant to the next control generation, in the same seat; the state version stays. Only the
     * new generation and the one before it keep a ledger, so repeated takeovers cannot grow the room: a screen
     * two or more takeovers behind has lost its stored results, and even its exact retry is CONTROL_LOST.
     */
    long advanceControl(String participantId) {
        for (int i = 0; i < participants.size(); i++) {
            Participant p = participants.get(i);
            if (p.participantId().equals(participantId)) {
                long next = p.controlGeneration() + 1;
                participants.set(i, new Participant(p.participantId(), p.name(), p.joinOrder(), next, p.credential()));
                ledgers.remove(participantId + "#" + (next - 2));
                return next;
            }
        }
        throw new RoomException(ErrorCode.ROOM_NOT_FOUND);
    }

    // 자리의 자격 값을 바꾼다
    void replaceCredential(String participantId, String credential) {
        for (int i = 0; i < participants.size(); i++) {
            Participant p = participants.get(i);
            if (p.participantId().equals(participantId)) {
                participants.set(i, new Participant(
                        p.participantId(), p.name(), p.joinOrder(), p.controlGeneration(), credential));
            }
        }
    }

    // 자리를 새 기기로 넘긴다. 칩과 방장은 그대로 두고 옛 연결을 끊어야 할 목록에 넣는다
    /**
     * Gives the seat to a new device: a new credential and control generation, and the old connections wait in
     * {@link #drainPendingRevocations}. Presence starts over, so the seat is absent since now and a waiting room
     * gives the new device the first-connection wait. The version is left to the command pipeline.
     */
    void recoverSeat(String participantId, String credential, Instant now) {
        replaceCredential(participantId, credential);
        advanceControl(participantId);
        pendingRevocations.addAll(presence.forget(participantId));
        presence.joined(participantId, now);
    }

    // 참가자를 내보내고 방장 승계와 방 닫기를 처리한다
    /**
     * Removes a participant. The dealer stays on the same person (-1 if that was the leaver); a leaving host
     * hands the room to the earliest connected joiner, or the earliest joiner left when nobody is connected; the
     * last one out closes the room. Their connections wait in {@link #drainPendingRevocations} to be ended, and
     * their pending recovery requests end now: no host can see or approve them any more.
     */
    void removeParticipant(String participantId, Instant now) {
        String dealer = dealerId();
        participants.removeIf(p -> p.participantId().equals(participantId));
        ledgers.keySet().removeIf(k -> k.startsWith(participantId + "#"));
        pendingRevocations.addAll(presence.forget(participantId));
        recoveryRequests.supersede(participantId, now);
        pointDealerAt(dealer);
        if (participants.isEmpty()) {
            hostId = null;
            hostTakeoverOpen = false;
            closed = true;
        } else if (participantId.equals(hostId)) {
            setHost(nextHost());
        }
    }

    // 연결된 사람을 먼저, 그다음 입장 순서로 다음 방장을 고른다
    private String nextHost() {
        return participants.stream()
                .min(Comparator.comparing((Participant p) -> !presence.isConnected(p.participantId()))
                        .thenComparingInt(Participant::joinOrder))
                .orElseThrow().participantId();
    }
}
