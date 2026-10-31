package xyz.jwlee.poker.server.room;

import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.TournamentStatus;

// 참가자 한 명이 지금 할 수 있는 조작 권한 모음
/** What one participant may do right now; the screen shows or hides controls from this. */
public record Capabilities(boolean canAct, boolean canUndo, boolean canSettle, boolean canEditSetup,
        boolean canEditBlinds) {

    // 방과 게임 상태에 따라 참가자의 조작 권한을 계산한다
    public static Capabilities of(Room room, String participantId) {
        boolean host = room.isHost(participantId);
        GameState game = room.game();
        boolean playing = room.phase() == RoomPhase.PLAYING && game != null && game.status == TournamentStatus.PLAYING;
        Hand hand = playing ? game.hand : null;
        String playerId = room.playerIds().get(participantId);
        boolean canAct = hand != null && hand.phase == Phase.BETTING && playerId != null
                && playerId.equals(hand.actorId);
        boolean canUndo = host && game != null && game.undo != null && !room.hasPlayerLeft();
        boolean canSettle = host && hand != null && hand.phase == Phase.SETTLEMENT;
        boolean canEditSetup = host && room.phase() == RoomPhase.WAITING;
        boolean canEditBlinds = host && room.phase() == RoomPhase.PLAYING;
        return new Capabilities(canAct, canUndo, canSettle, canEditSetup, canEditBlinds);
    }

    // 열린 방장 인수 요청을 이 참가자가 받을 수 있는지(접속 중, 진행 중이면 생존자) 확인한다
    public static boolean canTakeHost(Room room, String participantId) {
        return room.hostTakeoverOpen() && room.presence().isConnected(participantId)
                && (room.phase() != RoomPhase.PLAYING || GameCommands.canHoldRoom(room, participantId));
    }
}
