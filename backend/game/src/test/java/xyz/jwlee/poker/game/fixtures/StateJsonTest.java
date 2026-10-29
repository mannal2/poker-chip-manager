package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.UndoSnapshot;

class StateJsonTest {
    @TestFactory
    List<DynamicTest> everyFixtureStateRoundTrips() {
        List<DynamicTest> tests = new ArrayList<>();
        for (String suite : List.of("betting", "pots", "settlement", "lifecycle", "undo")) {
            for (JsonNode c : FixtureFiles.load(suite)) {
                JsonNode state = c.get("initialState");
                if (!state.has("players")) {
                    continue;
                }
                tests.add(dynamicTest(suite + " " + c.get("id").asText(), () -> {
                    assertThat(StateJson.write(StateJson.read(state))).isEqualTo(state);
                }));
            }
        }
        assertThat(tests).isNotEmpty();
        return tests;
    }

    @Test
    void undoSnapshotUsesTheFlatShapeWithOptionalEventIds() {
        JsonNode base = FixtureFiles.load("betting").get(0).get("initialState");
        ObjectNode withUndo = base.deepCopy();
        ObjectNode snapshot = base.deepCopy();
        snapshot.remove("undo");
        ArrayNode ids = JsonNodeFactory.instance.arrayNode().add("t:0").add("t:1");
        snapshot.set("eventIds", ids);
        withUndo.set("undo", snapshot);

        GameState read = StateJson.read(withUndo);
        UndoSnapshot undo = read.undo;
        assertThat(undo.eventIds()).containsExactly("t:0", "t:1");
        assertThat(undo.state().undo).isNull();
        assertThat(StateJson.write(read)).isEqualTo(withUndo);
    }
}
