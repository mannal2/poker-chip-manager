package xyz.jwlee.poker.server.room;

import static xyz.jwlee.poker.server.room.Payload.invalid;
import static xyz.jwlee.poker.server.room.Payload.object;
import static xyz.jwlee.poker.server.room.Payload.required;
import static xyz.jwlee.poker.server.room.Payload.requireEmpty;
import static xyz.jwlee.poker.server.room.Payload.string;

import java.time.Instant;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.game.GameEngine;
import xyz.jwlee.poker.game.TransitionResult;
import xyz.jwlee.poker.game.command.BuyInPlacement;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.FormerPlayer;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.settings.SettingsValidator;
import xyz.jwlee.poker.server.room.BuyInRequests.Request;
import xyz.jwlee.poker.server.room.BuyInRequests.Status;

// 진행 중인 방의 바이인 신청과 방장의 승인·거절·대기 바이인 취소 규칙을 방에 적용한다
/**
 * The caller holds the room lock. Every check runs before the room changes, and the engine's BUY_IN or CANCEL_BUY_IN
 * is computed on a copy first, so a refusal (from the room or the engine) leaves the room as it was. Approving a
 * newcomer seats a new participant with a fresh credential, handed only to the asking session; approving a re-entry
 * links the asking participant to the new player record. The pipeline bumps the version after a command.
 */
public final class BuyInCommands {

    private BuyInCommands() {}

    // 새 사람이 이름으로 바이인을 신청한다. 이 세션이 이미 이 방의 유효한 자리에 있으면 거절한다
    public static Request request(Room room, Optional<SeatBinding> caller, String askedBy, String name, RoomEnv env) {
        GameState game = requireOpen(room);
        if (caller.flatMap(room::seatOf).isPresent()) {
            throw new RoomException(ErrorCode.ALREADY_PARTICIPANT);
        }
        String normalized = SettingsValidator.normalizeName(name)
                .orElseThrow(() -> new RoomException(ErrorCode.INVALID_NAME));
        room.requireRoomFor(normalized);
        Request request = room.buyInRequests().add(env.newId(), askedBy, game.tournamentId, normalized, null, null,
                env.now());
        room.bumpVersion();
        return request;
    }

    // 탈락한 참가자 본인이 지금 플레이어 기록으로 재입장을 신청한다
    static void requestReentry(Room room, Participant actor, CommandRequest command, RoomEnv env) {
        requireEmpty(command.payload());
        GameState game = requireOpen(room);
        String playerId = room.playerIds().get(actor.participantId());
        if (playerId == null || !eliminated(game, playerId)) {
            throw new RoomException(ErrorCode.NOT_ELIMINATED);
        }
        room.buyInRequests().add(env.newId(), actor.participantId(), game.tournamentId, actor.name(), playerId,
                actor.participantId(), env.now());
    }

    // 대기 신청을 정한 자리로 승인해 엔진 바이인을 실행하고 참가자와 플레이어를 연결한다
    static void approve(Room room, Participant actor, CommandRequest command, RoomEnv env) {
        Instant now = env.now();
        JsonNode body = object(command.payload());
        Request request = pending(room, body, now);
        BuyInPlacement placement = placement(required(body, "placement"));
        GameState game = requireOpen(room);
        boolean reentry = request.reentryOf() != null;
        if (reentry) {
            String participantId = request.participantId();
            if (!room.hasParticipant(participantId)
                    || !request.reentryOf().equals(room.playerIds().get(participantId))) {
                throw new RoomException(ErrorCode.BUY_IN_NOT_PENDING);
            }
        } else {
            room.requireRoomFor(request.name());
        }
        TransitionResult.Applied applied = GameCommands.applied(GameEngine.transition(game,
                new GameCommand.BuyIn(request.name(), placement, request.reentryOf()), env.transition()));
        String playerId = boughtIn(applied);
        room.updateGame(applied.state(), applied.events());
        room.clearDraft();
        if (reentry) {
            room.rememberReentry(playerId, request.reentryOf());
            room.linkPlayer(request.participantId(), playerId);
            room.buyInRequests().approve(request, request.participantId(), null, now);
        } else {
            String participantId = env.newId();
            String credential = env.newId();
            room.addBoughtInParticipant(participantId, request.name(), credential, now);
            room.linkPlayer(participantId, playerId);
            room.buyInRequests().approve(request, participantId, credential, now);
        }
    }

    // 대기 신청을 거절한다
    static void reject(Room room, Participant actor, CommandRequest command, RoomEnv env) {
        Instant now = env.now();
        room.buyInRequests().reject(pending(room, object(command.payload()), now), now);
    }

    // 첫 카드 전의 바이인을 취소하고, 새 사람이면 방에서 내보내고 재입장이면 원래 탈락 기록에 다시 연결한다
    static void cancel(Room room, Participant actor, CommandRequest command, RoomEnv env) {
        String playerId = string(object(command.payload()), "playerId");
        GameState game = requirePlaying(room);
        TransitionResult.Applied applied = GameCommands.applied(
                GameEngine.transition(game, new GameCommand.CancelBuyIn(playerId), env.transition()));
        Optional<String> owner = room.participantOfPlayer(playerId);
        Optional<String> origin = room.takeReentryOrigin(playerId);
        room.updateGame(applied.state(), applied.events());
        room.clearDraft();
        owner.ifPresent(participantId -> {
            if (origin.isPresent()) {
                room.linkPlayer(participantId, origin.get());
            } else {
                room.unlinkPlayer(participantId);
                room.removeParticipant(participantId, env.now());
            }
        });
    }

    // 엔진 이벤트에서 바이인으로 앉은 새 플레이어 ID를 찾는다
    private static String boughtIn(TransitionResult.Applied applied) {
        for (GameEvent event : applied.events()) {
            if (event.details() instanceof EventDetails.PlayerBoughtIn bought) {
                return bought.playerId();
            }
        }
        throw new IllegalStateException("BUY_IN applied without a PlayerBoughtIn event");
    }

    // 플레이어가 자리에서 탈락했거나 다른 사람에게 자리를 내주었는지 확인한다
    private static boolean eliminated(GameState game, String playerId) {
        for (Player p : game.players) {
            if (p.id.equals(playerId)) {
                return p.eliminated;
            }
        }
        return game.formerPlayers != null && game.formerPlayers.stream()
                .anyMatch(f -> f.id().equals(playerId) && f.reason() == FormerPlayer.Reason.REPLACED);
    }

    // payload가 가리키는 신청이 이 토너먼트에서 아직 대기 중인지 확인해 돌려준다
    private static Request pending(Room room, JsonNode body, Instant now) {
        String id = string(body, "buyInRequestId");
        String tournamentId = room.game() == null ? null : room.game().tournamentId;
        return room.buyInRequests().find(id)
                .filter(r -> r.statusAt(now) == Status.PENDING && r.tournamentId().equals(tournamentId))
                .orElseThrow(() -> new RoomException(ErrorCode.BUY_IN_NOT_PENDING));
    }

    // 자리 payload({kind:'between', after} 또는 {kind:'replace', playerId})를 읽는다
    private static BuyInPlacement placement(JsonNode node) {
        JsonNode body = object(node);
        return switch (string(body, "kind")) {
            case "between" -> new BuyInPlacement.Between(string(body, "after"));
            case "replace" -> new BuyInPlacement.Replace(string(body, "playerId"));
            default -> throw invalid();
        };
    }

    // 바이인을 받을 수 있게 토너먼트가 진행 중인지 확인하고 게임을 돌려준다
    private static GameState requireOpen(Room room) {
        GameState game = room.game();
        if (room.phase() != RoomPhase.PLAYING || game == null || game.status != TournamentStatus.PLAYING) {
            throw new RoomException(ErrorCode.BUY_IN_CLOSED);
        }
        return game;
    }

    // 대기 바이인을 취소할 수 있게 게임이 진행 중인지 확인한다
    private static GameState requirePlaying(Room room) {
        GameState game = room.game();
        if (room.phase() != RoomPhase.PLAYING || game == null || game.status != TournamentStatus.PLAYING) {
            throw new RoomException(ErrorCode.INVALID_ACTION);
        }
        return game;
    }
}
