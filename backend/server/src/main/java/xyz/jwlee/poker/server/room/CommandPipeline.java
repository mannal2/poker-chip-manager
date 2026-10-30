package xyz.jwlee.poker.server.room;

import java.util.Objects;
import tools.jackson.databind.JsonNode;

/**
 * Runs one room command, one step per method, in this order; a step never replaces the one before it:
 * <ol>
 *   <li>format: the envelope shape is the API layer's job; {@link #validateType} here refuses a type that
 *       does not exist (UNKNOWN_TYPE, wire code INVALID_INPUT). Nothing is recorded.</li>
 *   <li>room lookup: done by the caller ({@code RoomRegistry.withRoom}; a closed room is not found).</li>
 *   <li>session participant: the caller is on the roster, else ROOM_NOT_FOUND.</li>
 *   <li>duplicate: the ledger of the participant's current control generation answers a retry with the
 *       stored outcome, or REQUEST_CONFLICT / RESULT_EXPIRED / SEQUENCE_GAP.</li>
 *   <li>control generation: CONTROL_LOST. It does not use up the sequence, because a holder of an old
 *       generation must not burn numbers of the new holder's ledger.</li>
 *   <li>permission: FORBIDDEN.</li>
 *   <li>tournament/hand scope: TOURNAMENT_CHANGED.</li>
 *   <li>room state version: STALE_STATE.</li>
 *   <li>rule and commit: the handler validates and changes the room, then the version goes up by one.</li>
 * </ol>
 * From the permission step on, a refusal is recorded as REJECTED and uses up the sequence.
 * The caller holds the room lock for the whole call.
 */
public final class CommandPipeline {

    @FunctionalInterface
    private interface Applier {
        void apply(Room room, Participant actor, JsonNode payload);
    }

    private record Handler(boolean hostOnly, Applier applier) { }

    /** The one place that connects a command type to its handler. */
    private static Handler handlerFor(String type) {
        return switch (type) {
            case "SET_SETTINGS" -> new Handler(true, WaitingRoomCommands::setSettings);
            case "SET_SEAT_ORDER" -> new Handler(true, WaitingRoomCommands::setSeatOrder);
            case "SET_DEALER" -> new Handler(true, WaitingRoomCommands::setDealer);
            case "RENAME" -> new Handler(false, WaitingRoomCommands::rename);
            case "KICK" -> new Handler(true, WaitingRoomCommands::kick);
            case "LEAVE" -> new Handler(false, WaitingRoomCommands::leave);
            case "TRANSFER_HOST" -> new Handler(true, WaitingRoomCommands::transferHost);
            // Add START and the game commands here (Task 7) and RE_READY (Task 8).
            default -> null;
        };
    }

    public CommandResult execute(Room room, String participantId, CommandRequest request) {
        Handler handler = requireKnownType(request);
        Participant actor = requireParticipant(room, participantId);
        String fingerprint = Fingerprint.of(request);
        RequestLedger ledger = room.ledger(actor.participantId(), actor.controlGeneration());
        RequestOutcome replay = duplicate(ledger, request, fingerprint);
        if (replay != null) {
            return new CommandResult(replay, room);
        }
        checkControl(actor, request);
        RequestOutcome outcome;
        try {
            checkPermission(room, actor, handler);
            checkScope(room, request);
            checkVersion(room, request);
            handler.applier().apply(room, actor, request.payload());
            room.bumpVersion();
            outcome = outcome(request, RequestOutcome.Outcome.APPLIED, "OK", room);
        } catch (RoomException e) {
            outcome = outcome(request, RequestOutcome.Outcome.REJECTED, e.code(), room);
        }
        ledger.record(outcome, fingerprint);
        return new CommandResult(outcome, room);
    }

    /** Step 1, for a caller that wants to refuse before looking the room up. */
    public static void validateType(CommandRequest request) {
        requireKnownType(request);
    }

    private static Handler requireKnownType(CommandRequest request) {
        Handler handler = handlerFor(request.type());
        if (handler == null) {
            throw new RoomException("UNKNOWN_TYPE");
        }
        return handler;
    }

    private static Participant requireParticipant(Room room, String participantId) {
        return room.participant(participantId).orElseThrow(() -> new RoomException("ROOM_NOT_FOUND"));
    }

    private static RequestOutcome duplicate(RequestLedger ledger, CommandRequest request, String fingerprint) {
        return switch (ledger.check(request.requestId(), request.sequence(), fingerprint)) {
            case RequestLedger.Check.Replay replay -> replay.outcome();
            case RequestLedger.Check.Conflict c -> throw new RoomException("REQUEST_CONFLICT");
            case RequestLedger.Check.Expired e -> throw new RoomException("RESULT_EXPIRED");
            case RequestLedger.Check.Gap g -> throw new RoomException("SEQUENCE_GAP");
            case RequestLedger.Check.New n -> null;
        };
    }

    private static void checkControl(Participant actor, CommandRequest request) {
        if (request.controlGeneration() != actor.controlGeneration()) {
            throw new RoomException("CONTROL_LOST");
        }
    }

    private static void checkPermission(Room room, Participant actor, Handler handler) {
        if (handler.hostOnly() && !room.isHost(actor.participantId())) {
            throw new RoomException("FORBIDDEN");
        }
    }

    /** The tournament is the room's game, or null while there is none; a hand never exists in the waiting room. */
    private static void checkScope(Room room, CommandRequest request) {
        String tournamentId = room.game() == null ? null : room.game().tournamentId;
        // Task 7: compare handId with the current hand once hands exist.
        if (!Objects.equals(tournamentId, request.tournamentId()) || request.handId() != null) {
            throw new RoomException("TOURNAMENT_CHANGED");
        }
    }

    private static void checkVersion(Room room, CommandRequest request) {
        if (request.expectedStateVersion() != room.version()) {
            throw new RoomException("STALE_STATE");
        }
    }

    private static RequestOutcome outcome(CommandRequest request, RequestOutcome.Outcome kind, String code, Room room) {
        return new RequestOutcome(request.requestId(), request.sequence(), kind, code, room.version(), null);
    }
}
