package xyz.jwlee.poker.server.room;

import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Phase;

/**
 * A started game on top of {@link CommandFixture}: participants a, b, c, d (seats in that order unless moved),
 * initial 1000, blinds 5/10, the dealer chosen by the caller. Commands carry the tournament and hand id
 * of the room's current game, like a client that has just read the state.
 */
final class GameFixture {

    final CommandFixture base;
    final Room room;
    private final Map<String, Long> sequences = new HashMap<>();

    GameFixture(int people, int dealerSeat) {
        this(people, dealerSeat, Clock.systemUTC());
    }

    // 주입한 시계로 명령을 처리하는 게임을 준비한다
    GameFixture(int people, int dealerSeat, Clock clock) {
        base = new CommandFixture(people, clock);
        room = base.room;
        String[] ids = {"a", "b", "c", "d"};
        check(send("a", "SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}"));
        check(send("a", "SET_DEALER", "{\"participantId\":\"" + ids[dealerSeat] + "\"}"));
    }

    static GameFixture started(int people, int dealerSeat) {
        GameFixture f = new GameFixture(people, dealerSeat);
        f.check(f.send("a", "START", "{}"));
        return f;
    }

    // 주입한 시계로 처리하는 시작된 게임을 만든다
    static GameFixture started(int people, int dealerSeat, Clock clock) {
        GameFixture f = new GameFixture(people, dealerSeat, clock);
        f.check(f.send("a", "START", "{}"));
        return f;
    }

    CommandResult send(String who, String type, String payload) {
        GameState g = room.game();
        String tournamentId = g == null ? null : g.tournamentId;
        String handId = g == null || g.hand == null ? null : g.hand.id;
        return sendScoped(who, type, payload, tournamentId, handId);
    }

    /** The command without a hand id, as the commands that do not need one may be sent. */
    CommandResult sendWithoutHand(String who, String type, String payload) {
        GameState g = room.game();
        return sendScoped(who, type, payload, g == null ? null : g.tournamentId, null);
    }

    CommandResult sendScoped(String who, String type, String payload, String tournamentId, String handId) {
        return base.pipeline.execute(room, who, request(who, type, payload, tournamentId, handId));
    }

    // 다음 순번과 현재 버전으로 요청을 만들되 보내지는 않는다
    CommandRequest request(String who, String type, String payload, String tournamentId, String handId) {
        long seq = sequences.merge(who, 1L, Long::sum);
        return new CommandRequest(1, tournamentId, "req-" + who + "-" + seq, seq, 1,
                room.version(), handId, type, CommandFixture.json(payload));
    }

    void check(CommandResult r) {
        if (!"OK".equals(r.outcome().code())) {
            throw new AssertionError("expected OK but was " + r.outcome().code());
        }
    }

    /** The participant whose turn it is. */
    String actor() {
        String playerId = room.game().hand.actorId;
        return room.playerIds().entrySet().stream().filter(e -> e.getValue().equals(playerId))
                .map(Map.Entry::getKey).findFirst().orElseThrow();
    }

    /** Everyone checks until the betting is over and the hand waits for a winner. */
    void checkDown() {
        while (room.game().hand.phase == Phase.BETTING) {
            check(send(actor(), "CHECK", null));
        }
    }
}
