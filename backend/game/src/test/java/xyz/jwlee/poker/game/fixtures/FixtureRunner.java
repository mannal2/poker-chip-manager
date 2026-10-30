package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import xyz.jwlee.poker.game.GameEngine;
import xyz.jwlee.poker.game.Invariants;
import xyz.jwlee.poker.game.Legal;
import xyz.jwlee.poker.game.Tournament;
import xyz.jwlee.poker.game.TransitionResult;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.gamejson.GameJson;

/**
 * Runs one shared command-sequence fixture (TS {@code fixtureRunner.ts}). Implements the generic
 * semantics documented in {@code schema.json}: per command input immutability, {@code expectError},
 * {@code expectedStateSubset}, {@code expectRestores}; per case {@code expectedError},
 * {@code expectedStateSubset}, {@code expectedLegal} and {@code expectedEvents}.
 */
public final class FixtureRunner {
    private static final String RUNNER_KEYS = "expectError expectedStateSubset expectRestores";

    private FixtureRunner() {}

    public static void run(JsonNode fixture) {
        JsonNode context = fixture.get("context");
        TransitionContext ctx = new TransitionContext(context.get("id").asText(), context.get("at").asText());
        JsonNode initial = fixture.get("initialState");
        // Betting-style cases carry a full state; lifecycle-style cases carry the settings.
        GameState state = initial.has("players")
                ? GameJson.readState(initial)
                : Tournament.create(GameJson.readSettings(initial), ctx);
        String expectedError = fixture.get("expectedError").isNull()
                ? null
                : fixture.get("expectedError").asText();

        List<GameState> history = new ArrayList<>();
        List<String> events = new ArrayList<>();
        JsonNode commands = fixture.get("commands");
        for (int i = 0; i < commands.size(); i++) {
            JsonNode raw = commands.get(i);
            boolean last = i == commands.size() - 1;
            history.add(state);
            String expectError = raw.has("expectError") ? raw.get("expectError").asText() : null;
            if (last && expectedError != null) {
                expectError = expectedError;
            }
            state = step(state, raw, expectError, ctx, events, history);
        }
        if (expectedError != null) {
            return;
        }
        JsonNode subset = fixture.get("expectedStateSubset");
        if (subset != null && !subset.isNull()) {
            JsonSubset.assertMatches(subset, GameJson.writeState(state));
        }
        JsonNode legal = fixture.get("expectedLegal");
        if (legal != null && !legal.isNull()) {
            JsonSubset.assertMatches(legal, GameJson.writeLegal(Legal.of(state)));
        }
        JsonNode expectedEvents = fixture.get("expectedEvents");
        if (expectedEvents != null) {
            for (JsonNode type : expectedEvents) {
                assertThat(events).as("emitted event types").contains(type.asText());
            }
        }
    }

    private static GameState step(
            GameState s,
            JsonNode raw,
            String expectError,
            TransitionContext ctx,
            List<String> events,
            List<GameState> history) {
        ObjectNode command = ((ObjectNode) raw).deepCopy();
        for (String key : RUNNER_KEYS.split(" ")) {
            command.remove(key);
        }
        JsonNode before = GameJson.writeState(s);
        TransitionResult r = GameEngine.transition(s, GameJson.readCommand(command), ctx);
        assertThat(GameJson.writeState(s)).as("input state must not change").isEqualTo(before);

        if (expectError != null) {
            if (!(r instanceof TransitionResult.Rejected rejected)) {
                return fail("The command must be rejected with " + expectError);
            }
            assertThat(rejected.code().name()).isEqualTo(expectError);
            if (raw.has("expectedStateSubset")) {
                JsonSubset.assertMatches(raw.get("expectedStateSubset"), GameJson.writeState(s));
            }
            return s;
        }
        if (!(r instanceof TransitionResult.Applied applied)) {
            return fail("Unexpected rejection: " + ((TransitionResult.Rejected) r).code());
        }
        GameState next = applied.state();
        Invariants.check(next);
        applied.events().forEach(e -> events.add(e.type()));
        if (raw.has("expectedStateSubset")) {
            JsonSubset.assertMatches(raw.get("expectedStateSubset"), GameJson.writeState(next));
        }
        if (raw.has("expectRestores")) {
            ObjectNode expected = GameJson.writeState(history.get(raw.get("expectRestores").asInt()));
            expected.put("version", s.version + 1);
            expected.putNull("undo");
            assertThat(GameJson.writeState(next)).isEqualTo(expected);
        }
        return next;
    }
}
