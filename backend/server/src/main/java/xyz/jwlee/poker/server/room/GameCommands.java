package xyz.jwlee.poker.server.room;

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

// 게임 시작과 진행 중 명령(베팅, 되돌리기, 정산, 기권 등)의 규칙을 방에 적용한다
/**
 * START and the in-game command rules. Like {@link WaitingRoomCommands}, each method validates everything
 * before it changes the room, so a refusal leaves the room untouched; the caller holds the room lock and
 * the pipeline bumps the version after a success. Every engine call gets a context with a server-generated id,
 * so tournament, hand and event ids never depend on a client's request id; a replay does not reach the engine.
 */
final class GameCommands {

    private GameCommands() {}

    // 시작 조건을 확인하고 참가자 순서대로 토너먼트를 만들어 게임을 시작한다
    static void start(Room room, Participant actor, CommandRequest request, RoomEnv env) {
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
        TransitionContext ctx = env.transition();
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

    // 현재 차례 참가자 본인의 베팅 행동을 엔진에 전달한다
    /** CHECK, CALL, FOLD, ALL_IN, BET and RAISE: only the current actor, always as themselves. */
    static void bet(Room room, Participant actor, CommandRequest request, RoomEnv env) {
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
        run(room, command, env);
    }

    // 직전 행동을 되돌린다
    static void undo(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        requireGame(room);
        if (room.hasPlayerLeft()) {
            throw new RoomException("UNDO_LOCKED");
        }
        run(room, new GameCommand.Undo(), env);
    }

    // 다음 핸드부터 쓸 블라인드를 예약한다
    static void scheduleBlinds(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        requireGame(room);
        JsonNode body = object(request.payload());
        run(room, new GameCommand.ScheduleBlinds(integer(body, "sb"), integer(body, "bb")), env);
    }

    // 방장이 고른 승자대로 핸드를 정산한다
    static void settleHand(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        requireGame(room);
        JsonNode body = object(request.payload());
        run(room, new GameCommand.SettleHand(winners(requiredField(body, "winners"))), env);
    }

    // 진행 중인 게임을 중단한다
    static void abort(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        requireGame(room);
        emptyPayload(request.payload());
        run(room, new GameCommand.Abort(), env);
    }

    // 방장이 아닌 참가자가 자기 자리를 포기한다
    /** A person gives up their own seat. The host must hand the room over first (MULTIPLAYER_MODE section 10). */
    static void forfeit(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        requirePlaying(room);
        emptyPayload(request.payload());
        if (room.isHost(actor.participantId())) {
            throw new RoomException("TRANSFER_HOST_FIRST");
        }
        String playerId = room.playerIds().get(actor.participantId());
        if (playerId == null) {
            throw new RoomException("INVALID_ACTION");
        }
        run(room, new GameCommand.Forfeit(playerId, false), env);
    }

    // 방장이 끊겨 있는 다른 참가자를 대신 기권시킨다
    /** The host gives up a seat whose person has no connection; a reconnected target is TARGET_CONNECTED. */
    static void forfeitDisconnected(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        requirePlaying(room);
        JsonNode target = requiredField(object(request.payload()), "participantId");
        if (!target.isString()) {
            throw invalid();
        }
        String targetId = target.asString();
        String playerId = room.playerIds().get(targetId);
        if (playerId == null || room.isHost(targetId)) {
            throw invalid();
        }
        if (room.presence().isConnected(targetId)) {
            throw new RoomException("TARGET_CONNECTED");
        }
        run(room, new GameCommand.Forfeit(playerId, true), env);
    }

    // 정산 중인 팟의 승자 선택 초안을 자격만 확인해 저장한다
    /**
     * The host's pick for the pot being settled. Only the eligibility is checked here; the payout rules run
     * when SETTLE_HAND is applied. The room version stays (the pipeline does not bump it for this command):
     * the draft has its own counter.
     */
    static void settlementDraft(Room room, Participant actor, CommandRequest request, RoomEnv env) {
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

    // 탈락·기권하지 않아 방장을 넘겨받을 수 있는 참가자인지 확인한다
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

    // 엔진으로 명령을 실행해 게임을 갱신하고, 블라인드 예약 명령이 아니라면 정산 초안을 지운다
    /** Applies the command; a settlement draft is dropped unless the command cannot change who may win. */
    private static void run(Room room, GameCommand command, RoomEnv env) {
        TransitionResult.Applied applied =
                applied(GameEngine.transition(room.game(), command, env.transition()));
        room.updateGame(applied.state(), applied.events());
        if (!(command instanceof GameCommand.ScheduleBlinds)) {
            room.clearDraft();
        }
    }

    // 명령이 거절되었으면 오류 코드가 담긴 예외를 던지고, 적용되었으면 새 상태와 이벤트를 담은 결과를 반환한다
    private static TransitionResult.Applied applied(TransitionResult result) {
        return switch (result) {
            case TransitionResult.Applied a -> a;
            case TransitionResult.Rejected r -> throw new RoomException(r.code().name());
        };
    }

    // 게임이 있는지 확인하고 돌려준다
    private static GameState requireGame(Room room) {
        if (room.game() == null) {
            throw new RoomException("INVALID_ACTION");
        }
        return room.game();
    }

    // 게임이 진행 중인지 확인하고 돌려준다
    /** A running game: in the waiting room or on the result screen there is nothing to play. */
    private static GameState requirePlaying(Room room) {
        GameState game = requireGame(room);
        if (room.phase() != RoomPhase.PLAYING || game.status != TournamentStatus.PLAYING) {
            throw new RoomException("INVALID_ACTION");
        }
        return game;
    }

    // 요청자가 현재 차례의 플레이어인지 확인하고 플레이어 id를 돌려준다
    private static String requireTurn(Room room, Participant actor, GameState game) {
        String playerId = room.playerIds().get(actor.participantId());
        if (playerId == null || game.hand == null || !playerId.equals(game.hand.actorId)) {
            throw new RoomException("NOT_YOUR_TURN");
        }
        return playerId;
    }

    // payload가 비어 있는지 확인한다
    private static void emptyPayload(JsonNode payload) {
        if (payload != null && !payload.isNull() && !(payload.isObject() && payload.isEmpty())) {
            throw invalid();
        }
    }

    // payload가 객체인지 확인한다
    private static JsonNode object(JsonNode payload) {
        if (payload == null || !payload.isObject()) {
            throw invalid();
        }
        return payload;
    }

    // 필수 필드를 꺼내고 없으면 예외를 던진다
    private static JsonNode requiredField(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null) {
            throw invalid();
        }
        return v;
    }

    // 정수 필드를 꺼내고 형식이 틀리면 예외를 던진다
    private static int integer(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || !v.isIntegralNumber() || !v.canConvertToInt()) {
            throw invalid();
        }
        return v.asInt();
    }

    // 팟별 승자 JSON을 맵으로 읽는다
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

    // 입력 형식 오류 예외를 만든다
    private static RoomException invalid() {
        return new RoomException("INVALID_INPUT");
    }
}
