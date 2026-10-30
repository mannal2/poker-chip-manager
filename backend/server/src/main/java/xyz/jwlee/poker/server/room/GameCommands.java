package xyz.jwlee.poker.server.room;

import java.time.Clock;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.game.GameEngine;
import xyz.jwlee.poker.game.Legal;
import xyz.jwlee.poker.game.Settlement;
import xyz.jwlee.poker.game.Tournament;
import xyz.jwlee.poker.game.TransitionResult;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.Pot;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;

/**
 * START and the in-game command rules. Like {@link WaitingRoomCommands}, each method validates everything
 * before it changes the room, so a refusal leaves the room untouched; the caller holds the room lock and
 * the pipeline bumps the version after a success. The engine gets the command's request id as its context id,
 * so event ids and hand ids derive from it and a replay of the same request never shows up twice.
 */
final class GameCommands {

    private GameCommands() {}

    static void start(Room room, Participant actor, CommandRequest request, Clock clock) {
        emptyPayload(request.payload());
        StartConditions.blockReason(room).ifPresent(reason -> {
            throw new RoomException(reason);
        });
        List<String> names = new ArrayList<>();
        Map<String, String> ids = new HashMap<>();
        List<Participant> seated = room.participants();
        for (int seat = 0; seat < seated.size(); seat++) {
            names.add(seated.get(seat).name());
            ids.put(seated.get(seat).participantId(), "p" + seat);
        }
        RoomSettings s = room.settings();
        TransitionContext ctx = context(request, clock);
        GameState created;
        try {
            created = Tournament.create(new GameSettings(names, s.initial(), s.sb(), s.bb(), s.button()), ctx);
        } catch (IllegalArgumentException e) {
            throw new RoomException("INVALID_SETTINGS");
        }
        TransitionResult.Applied applied =
                applied(GameEngine.transition(created, new GameCommand.StartTournament(), ctx));
        room.beginGame(applied.state(), ids, s);
        room.updateGame(applied.state(), applied.events());
    }

    /** CHECK, CALL, FOLD, ALL_IN, BET and RAISE: only the current actor, always as themselves. */
    static void bet(Room room, Participant actor, CommandRequest request, Clock clock) {
        GameState game = requirePlaying(room);
        String playerId = requireTurn(room, actor, game);
        GameCommand command = switch (request.type()) {
            case "CHECK" -> new GameCommand.Check(playerId);
            case "CALL" -> new GameCommand.Call(playerId);
            case "FOLD" -> {
                // Folding when nothing is owed is almost always a mis-tap, so the server refuses it.
                if (Legal.of(game).callAdditional() == 0) {
                    throw new RoomException("INVALID_ACTION");
                }
                yield new GameCommand.Fold(playerId);
            }
            case "ALL_IN" -> new GameCommand.AllIn(playerId);
            case "BET" -> new GameCommand.Bet(integer(object(request.payload()), "additional"), playerId);
            case "RAISE" -> new GameCommand.Raise(integer(object(request.payload()), "additional"), playerId);
            default -> throw new IllegalStateException("not a betting command: " + request.type());
        };
        run(room, command, request, clock);
    }

    static void undo(Room room, Participant actor, CommandRequest request, Clock clock) {
        requireGame(room);
        run(room, new GameCommand.Undo(), request, clock);
    }

    static void scheduleBlinds(Room room, Participant actor, CommandRequest request, Clock clock) {
        requireGame(room);
        JsonNode body = object(request.payload());
        run(room, new GameCommand.ScheduleBlinds(integer(body, "sb"), integer(body, "bb")), request, clock);
    }

    static void settleHand(Room room, Participant actor, CommandRequest request, Clock clock) {
        requireGame(room);
        JsonNode body = object(request.payload());
        run(room, new GameCommand.SettleHand(winners(requiredField(body, "winners"))), request, clock);
    }

    static void abort(Room room, Participant actor, CommandRequest request, Clock clock) {
        requireGame(room);
        emptyPayload(request.payload());
        run(room, new GameCommand.Abort(), request, clock);
    }

    /** A person gives up their own seat. The host must hand the room over first (MULTIPLAYER_MODE section 10). */
    static void forfeit(Room room, Participant actor, CommandRequest request, Clock clock) {
        requirePlaying(room);
        emptyPayload(request.payload());
        if (room.isHost(actor.participantId())) {
            throw new RoomException("TRANSFER_HOST_FIRST");
        }
        String playerId = room.playerIds().get(actor.participantId());
        if (playerId == null) {
            throw new RoomException("INVALID_ACTION");
        }
        run(room, new GameCommand.Forfeit(playerId), request, clock);
    }

    /**
     * The host's pick for the pot being settled. Only the eligibility is checked here; the payout rules run
     * when SETTLE_HAND is applied. The room version stays (the pipeline does not bump it for this command):
     * the draft has its own counter.
     */
    static void settlementDraft(Room room, Participant actor, CommandRequest request, Clock clock) {
        GameState game = requirePlaying(room);
        Hand hand = game.hand;
        if (hand == null || hand.phase != Phase.SETTLEMENT) {
            throw new RoomException("INVALID_ACTION");
        }
        JsonNode body = object(request.payload());
        int potIndex = integer(body, "potIndex");
        Map<String, List<String>> winners = winners(requiredField(body, "winners"));
        List<Pot> pots = Settlement.buildPots(game);
        if (potIndex < 0 || potIndex >= pots.size()) {
            throw invalid();
        }
        Map<String, Pot> byId = new HashMap<>();
        pots.forEach(p -> byId.put(p.id(), p));
        winners.forEach((potId, chosen) -> {
            Pot pot = byId.get(potId);
            if (pot == null || new HashSet<>(chosen).size() != chosen.size()
                    || !pot.eligible().containsAll(chosen)) {
                throw invalid();
            }
        });
        room.saveDraft(potIndex, winners);
    }

    /** Whether a hand-over target can still play: seated in the game and neither eliminated nor forfeited. */
    static boolean canHoldRoom(Room room, String participantId) {
        GameState game = room.game();
        String playerId = room.playerIds().get(participantId);
        if (game == null || playerId == null) {
            return false;
        }
        for (Player p : game.players) {
            if (p.id.equals(playerId)) {
                return !p.eliminated && !p.forfeited;
            }
        }
        return false;
    }

    /** Applies the command; a settlement draft is dropped unless the command cannot change who may win. */
    private static void run(Room room, GameCommand command, CommandRequest request, Clock clock) {
        TransitionResult.Applied applied =
                applied(GameEngine.transition(room.game(), command, context(request, clock)));
        room.updateGame(applied.state(), applied.events());
        if (!(command instanceof GameCommand.ScheduleBlinds)) {
            room.clearDraft();
        }
    }

    private static TransitionResult.Applied applied(TransitionResult result) {
        return switch (result) {
            case TransitionResult.Applied a -> a;
            case TransitionResult.Rejected r -> throw new RoomException(r.code().name());
        };
    }

    private static TransitionContext context(CommandRequest request, Clock clock) {
        return new TransitionContext(request.requestId(), clock.instant().toString());
    }

    private static GameState requireGame(Room room) {
        if (room.game() == null) {
            throw new RoomException("INVALID_ACTION");
        }
        return room.game();
    }

    /** A running game: in the waiting room or on the result screen there is nothing to play. */
    private static GameState requirePlaying(Room room) {
        GameState game = requireGame(room);
        if (room.phase() != RoomPhase.PLAYING || game.status != TournamentStatus.PLAYING) {
            throw new RoomException("INVALID_ACTION");
        }
        return game;
    }

    private static String requireTurn(Room room, Participant actor, GameState game) {
        String playerId = room.playerIds().get(actor.participantId());
        if (playerId == null || game.hand == null || !playerId.equals(game.hand.actorId)) {
            throw new RoomException("NOT_YOUR_TURN");
        }
        return playerId;
    }

    private static void emptyPayload(JsonNode payload) {
        if (payload != null && !payload.isNull() && !(payload.isObject() && payload.isEmpty())) {
            throw invalid();
        }
    }

    private static JsonNode object(JsonNode payload) {
        if (payload == null || !payload.isObject()) {
            throw invalid();
        }
        return payload;
    }

    private static JsonNode requiredField(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null) {
            throw invalid();
        }
        return v;
    }

    private static int integer(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || !v.isIntegralNumber() || !v.canConvertToInt()) {
            throw invalid();
        }
        return v.asInt();
    }

    /** {@code {potId: [playerId, ...]}}. */
    private static Map<String, List<String>> winners(JsonNode node) {
        if (node == null || !node.isObject()) {
            throw invalid();
        }
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> e : node.properties()) {
            if (!e.getValue().isArray()) {
                throw invalid();
            }
            List<String> ids = new ArrayList<>();
            for (JsonNode id : e.getValue()) {
                if (!id.isString()) {
                    throw invalid();
                }
                ids.add(id.asString());
            }
            out.put(e.getKey(), ids);
        }
        return out;
    }

    private static RoomException invalid() {
        return new RoomException("INVALID_INPUT");
    }
}
