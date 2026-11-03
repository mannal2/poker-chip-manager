package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import xyz.jwlee.poker.game.Round;
import xyz.jwlee.poker.game.Settlement;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Pot;
import xyz.jwlee.poker.gamejson.GameJson;

/** Mirrors {@code runPots} of the TS fixture runner. */
class PotsFixtureTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TestFactory
    List<DynamicTest> potsCases() {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : FixtureFiles.load("pots")) {
            tests.add(dynamicTest(c.get("id").asString() + " " + c.get("description").asString(), () -> run(c)));
        }
        assertThat(tests).hasSize(7);
        return tests;
    }

    private static void run(JsonNode f) {
        GameState s = GameJson.readState(f.get("initialState"));
        JsonNode expected = f.get("expectedStateSubset");
        int total = s.pot;
        List<Pot> built = List.of();
        for (JsonNode command : f.get("commands")) {
            switch (command.get("type").asString()) {
                case "RETURN_UNCALLED" -> {
                    EventDetails.UncalledReturned returned = Round.returnUncalled(s);
                    int amount = returned == null ? 0 : returned.amount();
                    assertThat(amount).isEqualTo(expected.get("returnAmount").asInt());
                    assertThat(s.pot).isEqualTo(total - amount);
                }
                case "BUILD_POTS" -> built = Settlement.buildPots(s);
                default -> throw new IllegalArgumentException("Unknown pots command " + command);
            }
        }
        assertThat(tree(built.stream().map(Pot::amount).toList())).isEqualTo(expected.get("amounts"));
        assertThat(tree(built.stream().map(Pot::eligible).toList()))
                .isEqualTo(expected.get("eligible"));
    }

    private static JsonNode tree(Object value) {
        return MAPPER.valueToTree(value);
    }
}
