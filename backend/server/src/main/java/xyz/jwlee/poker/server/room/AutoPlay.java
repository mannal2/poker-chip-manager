package xyz.jwlee.poker.server.room;

import java.time.Instant;
import java.util.Map;
import xyz.jwlee.poker.game.GameEngine;
import xyz.jwlee.poker.game.TransitionResult;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;

// 끊긴 사람의 차례를 체크 또는 폴드로 자동 처리한다
/**
 * Plays for disconnected seats (MULTIPLAYER_MODE section 13). While the hand is betting and the actor has been
 * disconnected for at least {@code env.grace().autoPlay()}, the engine checks (or folds when something is owed)
 * for them, one action after another, until a connected (or not yet long gone) person is to act or the betting
 * ends. The grace counts from the disconnect, not from the turn, so someone long gone is played for as soon as
 * their turn comes; the room sweep runs this every second to catch the moment a grace ends. It stops when nobody
 * still in the game is connected, so a room everyone left does not play itself out. The caller holds the room
 * lock and bumps the version.
 */
final class AutoPlay {

    private AutoPlay() {}

    // 유예가 지난 끊긴 행동자를 연결된 사람 차례까지 자동 처리하고 게임이 바뀌었으면 true를 돌려준다
    static boolean run(Room room, RoomEnv env) {
        boolean changed = false;
        while (shouldAct(room, env)) {
            TransitionResult result = GameEngine.autoAct(room.game(), env.transition());
            if (!(result instanceof TransitionResult.Applied applied)) {
                break;
            }
            room.updateGame(applied.state(), applied.events());
            changed = true;
        }
        return changed;
    }

    // 지금 자동 행동이 필요한지(베팅 중, 행동자가 유예 넘게 끊김, 연결된 생존자가 있음) 확인한다
    private static boolean shouldAct(Room room, RoomEnv env) {
        Instant due = env.now().minus(env.grace().autoPlay());
        GameState game = room.game();
        if (game == null || room.phase() != RoomPhase.PLAYING || game.status != TournamentStatus.PLAYING
                || game.hand == null || game.hand.phase != Phase.BETTING || game.hand.actorId == null) {
            return false;
        }
        boolean actorGone = false;
        boolean someoneConnected = false;
        for (Map.Entry<String, String> e : room.playerIds().entrySet()) {
            Player p = player(game, e.getValue());
            boolean connected = room.presence().isConnected(e.getKey());
            if (p != null && p.id.equals(game.hand.actorId) && !connected
                    && room.presence().absentSince(e.getKey()).filter(since -> !since.isAfter(due)).isPresent()) {
                actorGone = true;
            }
            if (p != null && !p.eliminated && !p.forfeited && connected) {
                someoneConnected = true;
            }
        }
        return actorGone && someoneConnected;
    }

    // 플레이어 id로 플레이어를 찾는다
    private static Player player(GameState game, String playerId) {
        return game.players.stream().filter(p -> p.id.equals(playerId)).findFirst().orElse(null);
    }
}
