package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

class ForfeitFixtureTest {
    @TestFactory
    List<DynamicTest> forfeitCases() {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : FixtureFiles.load("forfeit")) {
            tests.add(dynamicTest(c.get("id").asText() + " " + c.get("description").asText(), () -> FixtureRunner.run(c)));
        }
        assertThat(tests).hasSize(7);
        return tests;
    }
}
