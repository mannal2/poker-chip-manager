package xyz.jwlee.poker.server.room;

import java.util.List;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.game.Legal;
import xyz.jwlee.poker.gamejson.GameJson;

// 요청자별 방 상태 스냅샷 JSON을 만든다
/** Builds the per-requester snapshot JSON. The caller holds the room lock. */
public final class SnapshotWriter {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private SnapshotWriter() {}

    // 방, 참가자, 권한, 게임, 가능한 행동, 정산 초안을 담은 스냅샷을 만든다
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
        n.put("hostTakeoverOpen", room.hostTakeoverOpen());
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
            o.put("connected", room.presence().isConnected(p.participantId()));
        }
        ObjectNode you = n.putObject("you");
        you.put("participantId", viewer.participantId());
        you.put("controlGeneration", viewer.controlGeneration());
        you.put("canTakeHost", Capabilities.canTakeHost(room, viewer.participantId()));
        ObjectNode caps = you.putObject("capabilities");
        Capabilities c = Capabilities.of(room, viewer.participantId());
        caps.put("canAct", c.canAct());
        caps.put("canUndo", c.canUndo());
        caps.put("canSettle", c.canSettle());
        caps.put("canEditSetup", c.canEditSetup());
        caps.put("canEditBlinds", c.canEditBlinds());
        n.set("game", room.game() == null ? F.nullNode() : GameJson.writeState(room.game()));
        if (c.canAct()) {
            n.set("legal", GameJson.writeLegal(Legal.of(room.game())));
        } else {
            n.putNull("legal");
        }
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
