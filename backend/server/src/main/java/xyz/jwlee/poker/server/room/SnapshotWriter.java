package xyz.jwlee.poker.server.room;

import java.util.List;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.gamejson.GameJson;

/** Builds the per-requester snapshot JSON. The caller holds the room lock. */
public final class SnapshotWriter {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private SnapshotWriter() {}

    public static RoomSnapshot snapshot(Room room, Participant viewer) {
        ObjectNode n = F.objectNode();
        n.put("roomId", room.roomId());
        n.put("code", room.code());
        n.put("roomPhase", room.phase().name());
        n.put("stateVersion", room.version());
        if (room.game() == null) {
            n.putNull("tournamentId");
        } else {
            n.put("tournamentId", room.game().tournamentId);
        }
        RoomSettings s = room.settings();
        ObjectNode settings = n.putObject("settings");
        settings.put("initial", s.initial());
        settings.put("sb", s.sb());
        settings.put("bb", s.bb());
        settings.put("button", s.button());
        n.put("hostId", room.hostId());
        ArrayNode people = n.putArray("participants");
        List<Participant> all = room.participants();
        for (int seat = 0; seat < all.size(); seat++) {
            Participant p = all.get(seat);
            ObjectNode o = people.addObject();
            o.put("participantId", p.participantId());
            o.put("name", p.name());
            o.put("seat", seat);
            String playerId = room.playerIds().get(p.participantId());
            if (playerId == null) {
                o.putNull("playerId");
            } else {
                o.put("playerId", playerId);
            }
            o.put("isHost", room.isHost(p.participantId()));
        }
        ObjectNode you = n.putObject("you");
        you.put("participantId", viewer.participantId());
        you.put("controlGeneration", viewer.controlGeneration());
        ObjectNode caps = you.putObject("capabilities");
        // Only the waiting room is known so far; the full capability rules arrive with the command layer.
        boolean editSetup = room.phase() == RoomPhase.WAITING && room.isHost(viewer.participantId());
        caps.put("canAct", false);
        caps.put("canUndo", false);
        caps.put("canSettle", false);
        caps.put("canEditSetup", editSetup);
        caps.put("canEditBlinds", false);
        n.set("game", room.game() == null ? F.nullNode() : GameJson.writeState(room.game()));
        n.putNull("legal");
        SettlementDraft d = room.settlementDraft();
        if (d == null) {
            n.putNull("settlementDraft");
        } else {
            ObjectNode draft = n.putObject("settlementDraft");
            draft.put("draftVersion", d.draftVersion());
            draft.put("potIndex", d.potIndex());
            ObjectNode winners = draft.putObject("winners");
            d.winners().forEach((k, v) -> {
                ArrayNode a = winners.putArray(k);
                v.forEach(a::add);
            });
        }
        return new RoomSnapshot(n, room.version());
    }
}
