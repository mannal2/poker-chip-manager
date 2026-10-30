package xyz.jwlee.poker.server.room;

import java.time.Clock;
import tools.jackson.databind.JsonNode;

/**
 * Commands of the result screen. Like the other command classes, a method validates first and changes the
 * room only afterwards; the caller holds the room lock and the pipeline bumps the version after a success.
 */
final class ResultCommands {

    private ResultCommands() {}

    /**
     * Back to the waiting room for another tournament. The code, roster, names, seats, host, control
     * generations and request ledgers stay; the game and everything that belongs to it go. The settings
     * are the ones the tournament started with (blinds raised during the game do not carry over) and the
     * dealer button is cleared. A guest who forfeited stays on the roster: that flag lived in the game.
     */
    static void reReady(Room room, Participant actor, CommandRequest request, Clock clock) {
        JsonNode payload = request.payload();
        if (payload != null && !payload.isNull() && !(payload.isObject() && payload.isEmpty())) {
            throw new RoomException("INVALID_INPUT");
        }
        switch (room.phase()) {
            case PLAYING -> throw new RoomException("ABORT_FIRST");
            case WAITING -> throw new RoomException("INVALID_ACTION");
            case RESULT -> room.returnToWaiting();
        }
    }
}
