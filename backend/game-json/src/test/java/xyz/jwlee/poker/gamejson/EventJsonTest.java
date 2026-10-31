package xyz.jwlee.poker.gamejson;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import xyz.jwlee.poker.game.GameEngine;
import xyz.jwlee.poker.game.Tournament;
import xyz.jwlee.poker.game.TransitionResult;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.TransitionContext;

class EventJsonTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode eventCases() throws IOException {
        Path file = Path.of(System.getProperty("fixtures.dir")).resolve("events.json");
        return MAPPER.readTree(Files.readString(file));
    }

    /** Applies every command of an events fixture and returns all emitted events as JSON. */
    private static List<ObjectNode> emitted(JsonNode fixture) {
        JsonNode context = fixture.get("context");
        TransitionContext ctx = new TransitionContext(context.get("id").asString(), context.get("at").asString());
        GameState state = Tournament.create(GameJson.readSettings(fixture.get("initialState")), ctx);
        List<ObjectNode> out = new ArrayList<>();
        for (JsonNode command : fixture.get("commands")) {
            TransitionResult r = GameEngine.transition(state, GameJson.readCommand(command), ctx);
            if (!(r instanceof TransitionResult.Applied applied)) {
                throw new AssertionError("Rejected: " + r);
            }
            applied.events().forEach(e -> out.add(EventJson.write(e)));
            state = applied.state();
        }
        return out;
    }

    @TestFactory
    List<DynamicTest> sharedEventCasesMatchTheTsDetails() throws IOException {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : eventCases()) {
            tests.add(dynamicTest(c.get("id").asString() + " " + c.get("description").asString(), () -> {
                ArrayNode projected = JsonNodeFactory.instance.arrayNode();
                for (ObjectNode e : emitted(c)) {
                    ObjectNode n = projected.addObject();
                    n.set("type", e.get("type"));
                    n.set("details", e.get("details"));
                }
                assertThat(projected).isEqualTo(c.get("expectedEventDetails"));
            }));
        }
        assertThat(tests).hasSize(3);
        return tests;
    }

    @Test
    void sharedCasesCoverEveryTsEventType() throws IOException {
        List<String> types = new ArrayList<>();
        for (JsonNode c : eventCases()) {
            c.get("expectedEventDetails").forEach(e -> types.add(e.get("type").asString()));
        }
        assertThat(types)
                .contains(
                        "HAND_START", "CHECK", "CALL", "BET", "RAISE", "FOLD", "ALL_IN", "RETURN", "STREET",
                        "REVEAL", "PAYOUT", "ELIMINATED", "TOURNAMENT_END", "BLINDS_SCHEDULED", "UNDO", "ABORT");
    }

    @Test
    void envelopeCarriesIdAtTournamentHandTypeAndDetails() {
        TransitionContext ctx = new TransitionContext("T", "2026-10-18T00:00:00Z");
        GameState s = Tournament.create(new GameSettings(List.of("A", "B"), 1000, 5, 10, 0), ctx);
        TransitionResult.Applied r =
                (TransitionResult.Applied) GameEngine.transition(s, new GameCommand.StartTournament(), ctx);
        ObjectNode json = EventJson.write(r.events().get(0));

        assertThat(json.propertyNames()).containsExactly("id", "at", "tournamentId", "hand", "type", "details");
        assertThat(json.get("id").asString()).isEqualTo("T:0");
        assertThat(json.get("at").asString()).isEqualTo("2026-10-18T00:00:00Z");
        assertThat(json.get("tournamentId").asString()).isEqualTo("T");
        assertThat(json.get("hand").asInt()).isEqualTo(1);
        assertThat(json.get("type").asString()).isEqualTo("HAND_START");
    }

    @Test
    void forfeitEventsHaveTheirOwnDetailShapes() {
        TransitionContext ctx = new TransitionContext("F", "2026-10-18T00:00:00Z");
        GameState state = Tournament.create(new GameSettings(List.of("A", "B", "C"), 1000, 5, 10, 0), ctx);
        List<GameEvent> events = new ArrayList<>();
        List<GameCommand> commands =
                List.of(new GameCommand.StartTournament(), new GameCommand.Forfeit("p1", false), new GameCommand.Forfeit("p2", false));
        for (GameCommand command : commands) {
            TransitionResult.Applied r = (TransitionResult.Applied) GameEngine.transition(state, command, ctx);
            events.addAll(r.events());
            state = r.state();
        }
        List<ObjectNode> json = events.stream().map(EventJson::write).toList();

        // p0 never put chips in, so no live player owns the blinds: they go back to p1 and p2, who each
        // leave with their full 1000 and hand it to the only survivor p0.
        assertThat(details(json, "FORFEIT"))
                .containsExactly(object("{\"playerId\":\"p1\"}"), object("{\"playerId\":\"p2\"}"));
        assertThat(details(json, "FORFEIT_SPLIT"))
                .containsExactly(
                        object("{\"playerId\":\"p1\",\"shares\":{\"p0\":1000}}"),
                        object("{\"playerId\":\"p2\",\"shares\":{\"p0\":1000}}"));
    }

    @Test
    void automaticActionsAndHostForfeitsCarryTheirMarksOnlyWhenTrue() {
        String at = "2026-10-31T00:00:00Z";
        TransitionContext ctx = new TransitionContext("M", at);
        GameState state = Tournament.create(new GameSettings(List.of("A", "B", "C"), 1000, 5, 10, 0), ctx);
        state = ((TransitionResult.Applied) GameEngine.transition(state, new GameCommand.StartTournament(), ctx))
                .state();
        TransitionResult.Applied human = (TransitionResult.Applied)
                GameEngine.transition(state, new GameCommand.Call(null), new TransitionContext("M1", at));
        TransitionResult.Applied auto =
                (TransitionResult.Applied) GameEngine.autoAct(human.state(), new TransitionContext("M2", at));
        TransitionResult.Applied byHost = (TransitionResult.Applied) GameEngine.transition(
                auto.state(), new GameCommand.Forfeit("p0", true), new TransitionContext("M3", at));
        TransitionResult.Applied bySelf = (TransitionResult.Applied) GameEngine.transition(
                state, new GameCommand.Forfeit("p0", false), new TransitionContext("M4", at));

        assertThat(EventJson.write(human.events().get(0)).get("details").has("auto")).isFalse();
        assertThat(EventJson.write(auto.events().get(0)).get("details").get("auto").asBoolean())
                .isTrue();
        assertThat(EventJson.write(byHost.events().get(0)).get("details").get("byHost").asBoolean())
                .isTrue();
        assertThat(EventJson.write(bySelf.events().get(0)).get("details").has("byHost")).isFalse();
    }

    private static List<JsonNode> details(List<ObjectNode> events, String type) {
        return events.stream()
                .filter(e -> e.get("type").asString().equals(type))
                .map(e -> e.get("details"))
                .toList();
    }

    private static JsonNode object(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (JacksonException e) {
            throw new AssertionError(e);
        }
    }
}
