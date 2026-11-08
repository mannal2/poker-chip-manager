package xyz.jwlee.poker.server.room;

import static xyz.jwlee.poker.server.room.Payload.integer;
import static xyz.jwlee.poker.server.room.Payload.invalid;
import static xyz.jwlee.poker.server.room.Payload.object;
import static xyz.jwlee.poker.server.room.Payload.requireEmpty;
import static xyz.jwlee.poker.server.room.Payload.string;
import static xyz.jwlee.poker.server.room.Payload.strings;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.settings.SettingsValidation;
import xyz.jwlee.poker.game.settings.SettingsValidator;

// 대기실 명령(설정, 좌석, 딜러, 이름, 강퇴, 퇴장)과 방장 이전·인수의 규칙을 방에 적용한다
/**
 * The waiting-room command rules. Each method validates everything first and changes the room only after
 * every check passed, so a rejected command leaves the room untouched. A rejection is a
 * {@link RoomException}; the caller holds the room lock and bumps the version after a success.
 * Payload fields are checked for type explicitly: a missing or mistyped field is INVALID_INPUT.
 */
final class WaitingRoomCommands {

    private WaitingRoomCommands() {}

    // 시작 칩과 블라인드를 검증한 뒤 방 설정에 반영한다
    static void setSettings(Room room, Participant actor, JsonNode payload) {
        requireWaiting(room);
        JsonNode body = object(payload);
        int initial = integer(body, "initial");
        int sb = integer(body, "sb");
        int bb = integer(body, "bb");
        List<String> names = new ArrayList<>();
        room.participants().forEach(p -> names.add(p.name()));
        // The amount rules are checked together with the name rules; a room of one has too few names for the
        // validator, so pad with placeholders that cannot clash with each other.
        // A filler never equals (ignoring case) a real name, or a lone "seat0" would clash with its own filler.
        Set<String> taken = new HashSet<>();
        names.forEach(n -> taken.add(n.toLowerCase(Locale.ROOT)));
        for (int i = 0; names.size() < 2; i++) {
            String filler = "seat" + i;
            if (taken.add(filler)) {
                names.add(filler);
            }
        }
        GameSettings candidate = new GameSettings(names, initial, sb, bb, room.settings().button());
        if (!(SettingsValidator.validate(candidate) instanceof SettingsValidation.Valid)) {
            throw invalid();
        }
        room.replaceSettings(new RoomSettings(initial, sb, bb, room.settings().button()));
    }

    // 현재 참가자 전원이 정확히 한 번씩 들어 있을 때만 좌석 순서를 바꾼다
    static void setSeatOrder(Room room, Participant actor, JsonNode payload) {
        requireWaiting(room);
        List<String> order = strings(object(payload), "participantIds");
        Set<String> current = new HashSet<>();
        room.participants().forEach(p -> current.add(p.participantId()));
        if (order.size() != current.size() || !current.equals(new HashSet<>(order))) {
            throw invalid();
        }
        room.reorder(order);
    }

    // 방에 있는 참가자를 첫 딜러로 지정한다
    static void setDealer(Room room, Participant actor, JsonNode payload) {
        requireWaiting(room);
        room.setDealer(existing(room, string(object(payload), "participantId")));
    }

    // 이름 규칙과 중복을 확인한 뒤 요청자의 이름을 바꾼다
    static void rename(Room room, Participant actor, JsonNode payload) {
        requireWaiting(room);
        String raw = string(object(payload), "name");
        String name = SettingsValidator.normalizeName(raw).orElseThrow(() -> new RoomException("INVALID_NAME"));
        String lowered = name.toLowerCase(Locale.ROOT);
        boolean taken = room.participants().stream().anyMatch(p -> !p.participantId().equals(actor.participantId())
                && p.name().toLowerCase(Locale.ROOT).equals(lowered));
        if (taken) {
            throw new RoomException("DUPLICATE_NAME");
        }
        room.rename(actor.participantId(), name);
    }

    // 본인이 아닌 참가자를 방에서 내보낸다
    /**
     * In the waiting room anyone else; while a game runs only someone already out of it (eliminated or
     * forfeited), so a player with chips leaves the game only through a forfeit first.
     */
    static void kick(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        if (room.phase() != RoomPhase.PLAYING) {
            requireWaiting(room);
        }
        String target = existing(room, string(object(request.payload()), "participantId"));
        if (target.equals(actor.participantId())) {
            throw invalid();
        }
        requireOutOfThePlay(room, target);
        room.removeParticipant(target, env.now());
    }

    // 요청자가 방을 떠난다
    /**
     * Allowed in the waiting room and on the result screen; while a game runs only for someone already out of
     * it, and never for the host, who hands the room over first.
     */
    static void leave(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        JsonNode payload = request.payload();
        requireEmpty(payload);
        if (room.phase() == RoomPhase.PLAYING && room.isHost(actor.participantId())) {
            throw new RoomException("TRANSFER_HOST_FIRST");
        }
        requireOutOfThePlay(room, actor.participantId());
        room.removeParticipant(actor.participantId(), env.now());
    }

    // 진행 중이면 대상이 이미 탈락했거나 기권했는지 확인한다
    private static void requireOutOfThePlay(Room room, String participantId) {
        if (room.phase() == RoomPhase.PLAYING && GameCommands.canHoldRoom(room, participantId)) {
            throw new RoomException("NOT_ELIMINATED");
        }
    }

    // 방장 자리를 다른 참가자에게 넘긴다
    /**
     * While a game runs only to someone still in it (not eliminated, not forfeited); otherwise, in the waiting
     * room and after the game ended or was aborted, to anyone on the roster (MULTIPLAYER_MODE sections 7 and 13:
     * "종료·중단 후에는 누구에게나").
     */
    static void transferHost(Room room, Participant actor, JsonNode payload) {
        String target = existing(room, string(object(payload), "participantId"));
        switch (room.phase()) {
            case WAITING -> { }
            case PLAYING -> {
                if (!GameCommands.canHoldRoom(room, target)) {
                    throw invalid();
                }
            }
            case RESULT -> { }
        }
        room.setHost(target);
    }

    // 열린 인수 요청을 받아 요청자 본인이 방장이 된다
    /** The first valid acceptance wins: {@code setHost} closes the request, so a later one is HOST_TAKEOVER_CLOSED. */
    static void takeHost(Room room, Participant actor, JsonNode payload) {
        requireEmpty(payload);
        if (!room.hostTakeoverOpen()) {
            throw new RoomException("HOST_TAKEOVER_CLOSED");
        }
        if (!Capabilities.canTakeHost(room, actor.participantId())) {
            throw new RoomException("FORBIDDEN");
        }
        room.setHost(actor.participantId());
    }

    // 방이 대기 단계인지 확인한다
    private static void requireWaiting(Room room) {
        if (room.phase() != RoomPhase.WAITING) {
            throw new RoomException("NOT_WAITING");
        }
    }

    // 방에 있는 참가자 id인지 확인하고 돌려준다
    private static String existing(Room room, String participantId) {
        if (!room.hasParticipant(participantId)) {
            throw invalid();
        }
        return participantId;
    }





}
