package xyz.jwlee.poker.server.room;

import tools.jackson.databind.JsonNode;

// 결과 화면에서 쓰는 명령을 처리한다
/**
 * Commands of the result screen. Like the other command classes, a method validates first and changes the
 * room only afterwards; the caller holds the room lock and the pipeline bumps the version after a success.
 */
final class ResultCommands {

    private ResultCommands() {}

    // 결과 화면에서 대기실로 돌아가 새 토너먼트를 준비한다
    /**
     * Back to the waiting room for another tournament. The code, roster, names, seats, host, control
     * generations and request ledgers stay; the game and everything that belongs to it go. The settings
     * are the ones the tournament started with (blinds raised during the game do not carry over) and the
     * dealer button is cleared. A guest who forfeited stays on the roster: that flag lived in the game.
     * Whoever is absent gets a fresh waiting-room grace from this moment (M21); this runs only on the phase
     * change, so a refresh or a retry never extends it (M22). An open host takeover ends here.
     */
    static void reReady(Room room, Participant actor, CommandRequest request, RoomEnv env) {
        JsonNode payload = request.payload();
        Payload.requireEmpty(payload);
        switch (room.phase()) {
            case PLAYING -> throw new RoomException(ErrorCode.ABORT_FIRST);
            case WAITING -> throw new RoomException(ErrorCode.INVALID_ACTION);
            case RESULT -> {
                room.returnToWaiting();
                room.presence().restartAbsence(env.now());
                room.closeHostTakeover();
            }
        }
    }
}
