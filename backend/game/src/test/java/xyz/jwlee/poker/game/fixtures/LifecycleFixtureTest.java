package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import tools.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

class LifecycleFixtureTest {
    @TestFactory
    List<DynamicTest> lifecycleCases() {
        List<DynamicTest> tests = new ArrayList<>();
        int total = 0;
        for (JsonNode c : FixtureFiles.load("lifecycle")) {
            total++;
            tests.add(dynamicTest(c.get("id").asString() + " " + c.get("description").asString(), () -> FixtureRunner.run(c)));
        }
        assertThat(total).isEqualTo(14);
        assertThat(tests).hasSize(total);
        return tests;
    }
}
