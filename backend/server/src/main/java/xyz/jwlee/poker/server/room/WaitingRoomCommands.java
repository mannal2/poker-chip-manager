package xyz.jwlee.poker.server.room;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.settings.SettingsValidation;
import xyz.jwlee.poker.game.settings.SettingsValidator;

/**
 * The waiting-room command rules. Each method validates everything first and changes the room only after
 * every check passed, so a rejected command leaves the room untouched. A rejection is a
 * {@link RoomException}; the caller holds the room lock and bumps the version after a success.
 * Payload fields are checked for type explicitly: a missing or mistyped field is INVALID_INPUT.
 */
final class WaitingRoomCommands {

    private WaitingRoomCommands() {}

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
        for (int i = 0; names.size() < 2; i++) {
            names.add("seat" + i);
        }
        GameSettings candidate = new GameSettings(names, initial, sb, bb, room.settings().button());
        if (!(SettingsValidator.validate(candidate) instanceof SettingsValidation.Valid)) {
            throw invalid();
        }
        room.replaceSettings(new RoomSettings(initial, sb, bb, room.settings().button()));
    }

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

    static void setDealer(Room room, Participant actor, JsonNode payload) {
        requireWaiting(room);
        room.setDealer(existing(room, string(object(payload), "participantId")));
    }

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

    static void kick(Room room, Participant actor, JsonNode payload) {
        requireWaiting(room);
        String target = existing(room, string(object(payload), "participantId"));
        if (target.equals(actor.participantId())) {
            throw invalid();
        }
        room.removeParticipant(target);
    }

    /** Allowed in the waiting room and on the result screen, not while a game runs. */
    static void leave(Room room, Participant actor, JsonNode payload) {
        if (room.phase() == RoomPhase.PLAYING) {
            throw new RoomException("NOT_WAITING");
        }
        if (payload != null && !payload.isNull() && !(payload.isObject() && payload.isEmpty())) {
            throw invalid();
        }
        room.removeParticipant(actor.participantId());
    }

    /** In the waiting room to anyone; once a game runs (2B+) only to someone not eliminated. */
    static void transferHost(Room room, Participant actor, JsonNode payload) {
        requireWaiting(room);
        room.setHost(existing(room, string(object(payload), "participantId")));
    }

    private static void requireWaiting(Room room) {
        if (room.phase() != RoomPhase.WAITING) {
            throw new RoomException("NOT_WAITING");
        }
    }

    private static String existing(Room room, String participantId) {
        if (!room.hasParticipant(participantId)) {
            throw invalid();
        }
        return participantId;
    }

    private static JsonNode object(JsonNode payload) {
        if (payload == null || !payload.isObject()) {
            throw invalid();
        }
        return payload;
    }

    private static String string(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || !v.isString()) {
            throw invalid();
        }
        return v.asString();
    }

    private static int integer(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || !v.isIntegralNumber() || !v.canConvertToInt()) {
            throw invalid();
        }
        return v.asInt();
    }

    private static List<String> strings(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || !v.isArray()) {
            throw invalid();
        }
        List<String> out = new ArrayList<>();
        for (JsonNode e : v) {
            if (!e.isString()) {
                throw invalid();
            }
            out.add(e.asString());
        }
        return out;
    }

    private static RoomException invalid() {
        return new RoomException("INVALID_INPUT");
    }
}
