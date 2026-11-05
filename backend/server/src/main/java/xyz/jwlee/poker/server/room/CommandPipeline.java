package xyz.jwlee.poker.server.room;

import java.time.Clock;
import java.util.Objects;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.server.support.IdGenerator;

// 방 명령 하나를 검증 단계 순서대로 거쳐 실행하고 결과를 기록한다
/**
 * Runs one room command, one step per method, in this order; a step never replaces the one before it:
 * <ol>
 *   <li>format: the envelope shape is the API layer's job; {@link #validateType} here refuses a type that
 *       does not exist (UNKNOWN_TYPE, wire code INVALID_INPUT). Nothing is recorded.</li>
 *   <li>room lookup: done by the caller ({@code RoomRegistry.update}; a closed room is not found).</li>
 *   <li>session participant: the caller has matched the session to this seat with {@link Room#seatOf} under
 *       the same lock; here the seat must be on the roster, else ROOM_NOT_FOUND.</li>
 *   <li>control generation: the request's generation picks the ledger. Any generation other than the
 *       participant's current one (old or never issued) gets only the exact retry of a request that
 *       generation's ledger still holds; everything else is CONTROL_LOST. No ledger is created for it and
 *       nothing is recorded, so a stale screen can neither grow the room's memory nor burn sequence numbers.</li>
 *   <li>duplicate: the current generation's ledger answers a retry with the stored outcome, or
 *       REQUEST_CONFLICT / RESULT_EXPIRED / SEQUENCE_GAP.</li>
 *   <li>permission: FORBIDDEN.</li>
 *   <li>tournament/hand scope: TOURNAMENT_CHANGED.</li>
 *   <li>room state version: STALE_STATE. A command that does not bump the version (the settlement draft) skips
 *       this step, so another person's connection flip cannot refuse it; its hand scope above still applies.</li>
 *   <li>rule and commit: the handler validates and changes the room, then the version goes up by one.</li>
 * </ol>
 * From the permission step on, a refusal is recorded as REJECTED and uses up the sequence. CONTROL_LOST is the
 * one business refusal that does not (SYSTEM_SPEC: a refused command uses up its number, a dropped generation's
 * new commands are refused for good): that stream has ended, so there is no later number to keep in order.
 * The caller holds the room lock for the whole call.
 */
public final class CommandPipeline {

    // 명령 종류별 규칙을 방에 적용하는 처리기 형식
    @FunctionalInterface
    private interface Applier {
        // 명령을 방에 적용한다
        void apply(Room room, Participant actor, CommandRequest request, RoomEnv env);
    }

    // 대기실 명령처럼 payload만 필요한 처리기 형식
    @FunctionalInterface
    private interface WaitingApplier {
        // payload만으로 대기실 명령을 적용한다
        void apply(Room room, Participant actor, JsonNode payload);
    }

    // 명령 종류별 실행 조건(방장 전용, 핸드 범위, 버전 증가)과 처리기
    /**
     * {@code handScoped}: the request must carry the current hand id; otherwise a hand id is optional but,
     * when present, must match. {@code bumpsVersion}: false only for the settlement draft, which has its own counter
     * and so is not held to the room's state version either.
     */
    private record Handler(boolean hostOnly, boolean handScoped, boolean bumpsVersion, Applier applier) { }

    // 핸드 범위가 없고 버전을 올리는 일반 처리기를 만든다
    private static Handler plain(boolean hostOnly, Applier applier) {
        return new Handler(hostOnly, false, true, applier);
    }

    // 대기실 명령용 처리기를 만든다
    private static Handler waiting(boolean hostOnly, WaitingApplier applier) {
        return plain(hostOnly, (room, actor, request, env) -> applier.apply(room, actor, request.payload()));
    }

    // 명령 종류에 맞는 처리기를 찾고 없으면 null을 돌려준다
    /** The one place that connects a command type to its handler. */
    private static Handler handlerFor(String type) {
        return switch (type) {
            case "SET_SETTINGS" -> waiting(true, WaitingRoomCommands::setSettings);
            case "SET_SEAT_ORDER" -> waiting(true, WaitingRoomCommands::setSeatOrder);
            case "SET_DEALER" -> waiting(true, WaitingRoomCommands::setDealer);
            case "RENAME" -> waiting(false, WaitingRoomCommands::rename);
            case "KICK" -> plain(true, WaitingRoomCommands::kick);
            case "LEAVE" -> plain(false, WaitingRoomCommands::leave);
            case "TRANSFER_HOST" -> waiting(true, WaitingRoomCommands::transferHost);
            case "TAKE_HOST" -> waiting(false, WaitingRoomCommands::takeHost);
            case "START" -> plain(true, GameCommands::start);
            case "CHECK", "CALL", "FOLD", "ALL_IN", "BET", "RAISE" ->
                    new Handler(false, true, true, GameCommands::bet);
            case "UNDO" -> plain(true, GameCommands::undo);
            case "SCHEDULE_BLINDS" -> plain(true, GameCommands::scheduleBlinds);
            case "SETTLE_HAND" -> new Handler(true, true, true, GameCommands::settleHand);
            case "SETTLEMENT_DRAFT" -> new Handler(true, true, false, GameCommands::settlementDraft);
            case "FORFEIT" -> plain(false, GameCommands::forfeit);
            case "FORFEIT_DISCONNECTED" -> plain(true, GameCommands::forfeitDisconnected);
            case "ABORT" -> plain(true, GameCommands::abort);
            case "ABORT_AND_RE_READY" -> plain(true, GameCommands::abortAndReReady);
            case "RE_READY" -> plain(true, ResultCommands::reReady);
            case "RECOVERY_APPROVE" -> plain(true, RecoveryCommands::approve);
            case "RECOVERY_REJECT" -> plain(true, RecoveryCommands::reject);
            default -> null;
        };
    }

    private final RoomEnv env;

    public CommandPipeline(Clock clock, IdGenerator ids) {
        this(clock, ids, new StartGate());
    }

    // 서버 전체 시작 게이트를 읽는 파이프라인을 만든다
    public CommandPipeline(Clock clock, IdGenerator ids, StartGate gate) {
        this.env = new RoomEnv(clock, ids, gate);
    }

    public CommandPipeline() {
        this(Clock.systemUTC(), IdGenerator.random());
    }

    // 종류, 참가자, 조작권, 중복, 권한, 범위, 버전을 차례로 확인하고 명령을 적용한다
    public CommandResult execute(Room room, String participantId, CommandRequest request) {
        Handler handler = requireKnownType(request);
        Participant actor = requireParticipant(room, participantId);
        String fingerprint = Fingerprint.of(request);
        if (request.controlGeneration() != actor.controlGeneration()) {
            return new CommandResult(replayOfAnotherGeneration(room, actor, request, fingerprint), room);
        }
        RequestLedger ledger = room.ledger(actor.participantId(), actor.controlGeneration());
        Optional<RequestOutcome> replay = ledger.replayOf(request.requestId(), request.sequence(), fingerprint);
        if (replay.isPresent()) {
            return new CommandResult(replay.get(), room);
        }
        RequestOutcome outcome;
        try {
            checkPermission(room, actor, handler);
            checkScope(room, request, handler);
            checkVersion(room, request, handler);
            handler.applier().apply(room, actor, request, env);
            if (handler.bumpsVersion()) {
                AutoPlay.run(room, env);
                room.bumpVersion();
            }
            outcome = outcome(request, RequestOutcome.Outcome.APPLIED, "OK", room);
        } catch (RoomException e) {
            outcome = outcome(request, RequestOutcome.Outcome.REJECTED, e.code(), room);
        }
        ledger.record(outcome, fingerprint);
        return new CommandResult(outcome, room);
    }

    // 현재 세대가 맞을 때만 참가자에게 다음 조작권 세대를 발급한다
    /**
     * Issues the participant's next control generation when {@code expectedGeneration} is the current one, else
     * CONTROL_LOST, so of two screens racing for the same generation one wins. The new generation's ledger starts
     * at sequence 1. The state version stays: other participants' commands must not turn stale. Deduplication is
     * the caller's, on the session stream, because a takeover does not belong to any generation's ledger.
     */
    public static long takeControl(Room room, String participantId, long expectedGeneration) {
        Participant actor = requireParticipant(room, participantId);
        if (expectedGeneration != actor.controlGeneration()) {
            throw new RoomException("CONTROL_LOST");
        }
        long issued = room.advanceControl(participantId);
        room.requestSnapshotsOf(participantId);
        return issued;
    }

    // 존재하지 않는 명령 종류를 미리 거절한다
    /** Step 1, for a caller that wants to refuse before looking the room up. */
    public static void validateType(CommandRequest request) {
        requireKnownType(request);
    }

    // 명령 종류의 처리기를 찾고 없으면 예외를 던진다
    private static Handler requireKnownType(CommandRequest request) {
        Handler handler = handlerFor(request.type());
        if (handler == null) {
            throw new RoomException("UNKNOWN_TYPE");
        }
        return handler;
    }

    // 방 참가자를 찾고 없으면 예외를 던진다
    private static Participant requireParticipant(Room room, String participantId) {
        return room.participant(participantId).orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
    }

    // 현재와 다른 조작권 세대의 요청은 해당 세대의 원장에 ID, 순번, 지문이 모두 일치하는 결과가 있을 때만 반환하고, 그렇지 않으면 조작권 상실로 거절한다
    /** The stored outcome of an exact retry under a generation that is not the current one, else CONTROL_LOST. */
    private static RequestOutcome replayOfAnotherGeneration(
            Room room, Participant actor, CommandRequest request, String fingerprint) {
        return room.existingLedger(actor.participantId(), request.controlGeneration())
                .map(ledger -> ledger.check(request.requestId(), request.sequence(), fingerprint)
                        instanceof RequestLedger.Check.Replay replay ? replay.outcome() : null)
                .orElseThrow(() -> new RoomException("CONTROL_LOST"));
    }

    // 방장 전용 명령을 방장이 아닌 사람이 보내면 거절한다
    private static void checkPermission(Room room, Participant actor, Handler handler) {
        if (handler.hostOnly() && !room.isHost(actor.participantId())) {
            throw new RoomException("FORBIDDEN");
        }
    }

    // 요청의 토너먼트와 핸드가 현재 게임과 맞는지 확인한다
    /**
     * The tournament is the room's game, or null while there is none. The hand is the game's current hand;
     * a hand-scoped command must name it, any other command may leave it out.
     */
    private static void checkScope(Room room, CommandRequest request, Handler handler) {
        GameState game = room.game();
        String tournamentId = game == null ? null : game.tournamentId;
        String handId = game == null || game.hand == null ? null : game.hand.id;
        boolean handMatches = handler.handScoped()
                ? Objects.equals(handId, request.handId())
                : request.handId() == null || request.handId().equals(handId);
        if (!Objects.equals(tournamentId, request.tournamentId()) || !handMatches) {
            throw new RoomException("TOURNAMENT_CHANGED");
        }
    }

    // 버전을 올리는 명령이 기대한 방 상태 버전이 현재와 같은지 확인한다
    private static void checkVersion(Room room, CommandRequest request, Handler handler) {
        if (handler.bumpsVersion() && request.expectedStateVersion() != room.version()) {
            throw new RoomException("STALE_STATE");
        }
    }

    // 요청 결과 기록 객체를 만든다
    private static RequestOutcome outcome(CommandRequest request, RequestOutcome.Outcome kind, String code, Room room) {
        return new RequestOutcome(request.requestId(), request.sequence(), kind, code, room.version(), null);
    }
}
