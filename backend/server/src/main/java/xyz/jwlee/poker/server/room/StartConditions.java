package xyz.jwlee.poker.server.room;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.settings.SettingsValidation;
import xyz.jwlee.poker.game.settings.SettingsValidator;

/** Why a waiting room cannot start a game yet, as a stable code; empty when it can. */
public final class StartConditions {

    private StartConditions() {}

    public static Optional<String> blockReason(Room room) {
        if (room.phase() != RoomPhase.WAITING) {
            return Optional.of("NOT_WAITING");
        }
        int count = room.participants().size();
        if (count < 2 || count > Room.MAX_PARTICIPANTS) {
            return Optional.of("PLAYER_COUNT");
        }
        RoomSettings s = room.settings();
        if (s.button() < 0 || s.button() >= count) {
            return Optional.of("NO_DEALER");
        }
        List<String> names = new ArrayList<>();
        room.participants().forEach(p -> names.add(p.name()));
        if (!(SettingsValidator.validate(new GameSettings(names, s.initial(), s.sb(), s.bb(), s.button()))
                instanceof SettingsValidation.Valid)) {
            return Optional.of("INVALID_SETTINGS");
        }
        if (!everyoneConnected(room)) {
            return Optional.of("NOT_CONNECTED");
        }
        return Optional.empty();
    }

    /**
     * 2A stub: connections are not tracked yet, so everyone counts as connected.
     * 2B replaces this with the real presence check (the single place to change).
     */
    private static boolean everyoneConnected(Room room) {
        return true;
    }
}
