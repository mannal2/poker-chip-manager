package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import xyz.jwlee.poker.game.Settlement;
import xyz.jwlee.poker.game.SettlementPreview;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Pot;
import xyz.jwlee.poker.gamejson.GameJson;

/** Mirrors {@code runSettlement} of the TS fixture runner. */
class SettlementFixtureTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TestFactory
    List<DynamicTest> settlementCases() {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : FixtureFiles.load("settlement")) {
            tests.add(dynamicTest(c.get("id").asString() + " " + c.get("description").asString(), () -> run(c)));
        }
        assertThat(tests).hasSize(13);
        return tests;
    }

    private static void run(JsonNode f) {
        GameState s = GameJson.readState(f.get("initialState"));
        JsonNode expected = f.get("expectedStateSubset");
        for (JsonNode command : f.get("commands")) {
            assertThat(command.get("type").asString()).isEqualTo("PREVIEW_SETTLEMENT");
            List<Pot> pots = f.has("pots") ? readPots(f.get("pots")) : Settlement.buildPots(s);
            SettlementPreview r = Settlement.preview(s, winners(command.get("winners")), pots);
            assertThat(r.ok()).isEqualTo(expected.get("ok").asBoolean());
            if (expected.has("payouts")) {
                assertThat(tree(r.payouts())).isEqualTo(expected.get("payouts"));
            }
            if (expected.has("allocations")) {
                JsonSubset.assertMatches(expected.get("allocations"), tree(r.allocations()));
            }
            if (expected.has("pots")) {
                assertThat(tree(Settlement.buildPots(s))).isEqualTo(expected.get("pots"));
            }
        }
    }

    private static List<Pot> readPots(JsonNode n) {
        List<Pot> pots = new ArrayList<>();
        for (JsonNode p : n) {
            List<String> eligible = new ArrayList<>();
            p.get("eligible").forEach(e -> eligible.add(e.asString()));
            pots.add(new Pot(p.get("id").asString(), p.get("amount").asInt(), eligible));
        }
        return pots;
    }

    private static Map<String, List<String>> winners(JsonNode n) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        n.properties().forEach(e -> {
            List<String> ids = new ArrayList<>();
            e.getValue().forEach(v -> ids.add(v.asString()));
            out.put(e.getKey(), ids);
        });
        return out;
    }

    private static JsonNode tree(Object value) {
        return MAPPER.valueToTree(value);
    }
}
