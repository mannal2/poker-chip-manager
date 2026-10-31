package xyz.jwlee.poker.server.room;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.support.IdGenerator;

/** A waiting room with host "a" (Alice) and guests "b" (Bob), "c" (Carol), "d" (Dave), and a command sender. */
final class CommandFixture {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    final Room room = new Room("room1", "ABC234", Instant.EPOCH);
    final CommandPipeline pipeline;
    private final Map<String, Long> used = new HashMap<>();

    CommandFixture(int people) {
        this(people, Clock.systemUTC());
    }

    // 주입한 시계로 명령을 처리하는 방을 만든다
    CommandFixture(int people, Clock clock) {
        pipeline = new CommandPipeline(clock, IdGenerator.random());
        String[] ids = {"a", "b", "c", "d"};
        String[] names = {"Alice", "Bob", "Carol", "Dave"};
        for (int i = 0; i < people; i++) {
            room.addParticipant(ids[i], names[i], credential(ids[i]), Instant.EPOCH);
            room.presence().attach(ids[i], "conn-" + ids[i], Instant.EPOCH);
        }
    }

    // 참가자의 처음 자격 값을 돌려준다
    static String credential(String who) {
        return "cred-" + who;
    }

    // 참가자의 처음 자리 자격을 돌려준다
    static SeatBinding binding(String who) {
        return new SeatBinding(who, credential(who));
    }

    static JsonNode json(String text) {
        return text == null ? null : MAPPER.readTree(text);
    }

    /** Sends the participant's next in-sequence command at the room's current version and generation 1. */
    CommandResult send(String who, String type, String payload) {
        return send(who, type, payload, room.version());
    }

    CommandResult send(String who, String type, String payload, long expectedVersion) {
        long seq = used.merge(who, 1L, Long::sum);
        return pipeline.execute(room, who, request("req-" + who + "-" + seq, seq, 1, expectedVersion, type, payload));
    }

    static CommandRequest request(
            String requestId, long seq, long generation, long expectedVersion, String type, String payload) {
        return new CommandRequest(1, null, requestId, seq, generation, expectedVersion, null, type, json(payload));
    }

    static String code(CommandResult r) {
        return r.outcome().code();
    }

    String names() {
        StringBuilder sb = new StringBuilder();
        room.participants().forEach(p -> sb.append(p.name()).append(','));
        return sb.toString();
    }
}
