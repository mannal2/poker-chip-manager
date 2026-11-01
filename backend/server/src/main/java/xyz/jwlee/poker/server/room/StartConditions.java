package xyz.jwlee.poker.server.room;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.settings.SettingsValidation;
import xyz.jwlee.poker.game.settings.SettingsValidator;

// 대기실에서 게임을 시작할 수 있는지 판단한다
/** Why a waiting room cannot start a game yet, as a stable code; empty when it can. */
public final class StartConditions {

    private StartConditions() {}

    // 시작을 막는 이유 코드를 돌려주고 시작 가능하면 빈 값을 돌려준다
    public static Optional<String> blockReason(Room room, StartGate gate) {
        if (room.phase() != RoomPhase.WAITING) {
            return Optional.of("NOT_WAITING");
        }
        if (gate.isClosed()) {
            return Optional.of("DEPLOY_PENDING");
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

    // 모든 참가자가 연결 중인지 확인한다
    private static boolean everyoneConnected(Room room) {
        return room.participants().stream().allMatch(p -> room.presence().isConnected(p.participantId()));
    }
}
